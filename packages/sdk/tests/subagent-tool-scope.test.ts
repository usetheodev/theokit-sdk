import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkToolWhitelist } from "../src/internal/concurrency/async-local-storage.js";
import {
  subagentToolWhitelist,
  withSubagentToolScope,
} from "../src/internal/runtime/skills/subagent-tool-scope.js";
import { loadSubagents } from "../src/internal/runtime/skills/subagents-loader.js";
// barrel/subpath import (wiring) — proves the public @theokit/sdk/subagents surface
import {
  withSubagentToolScope as scopeFromSubpath,
  subagentToolWhitelist as whitelistFromSubpath,
} from "../src/subagents.js";
import type { AgentDefinition } from "../src/types/agent.js";

const def = (over: Partial<AgentDefinition>): AgentDefinition => ({
  description: "",
  prompt: "",
  ...over,
});

async function withAgentsDir<T>(
  files: Record<string, string>,
  fn: (cwd: string) => Promise<T>,
): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "subagent-scope-"));
  try {
    const dir = join(cwd, ".theokit", "agents");
    await mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      await writeFile(join(dir, name), body, "utf8");
    }
    return await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("subagent tools frontmatter (M4-6)", () => {
  it("parses a `tools:` frontmatter into definition.tools", async () => {
    await withAgentsDir(
      { "scoped.md": "---\ndescription: ro\ntools: read_file, list_dir\n---\nbody" },
      async (cwd) => {
        const agents = await loadSubagents(cwd, true, undefined);
        expect(agents.scoped?.tools).toEqual(["read_file", "list_dir"]);
      },
    );
  });

  it("a subagent without `tools:` has undefined tools", async () => {
    await withAgentsDir({ "plain.md": "---\ndescription: d\n---\nbody" }, async (cwd) => {
      const agents = await loadSubagents(cwd, true, undefined);
      expect(agents.plain?.tools).toBeUndefined();
    });
  });

  it("(EC-1) trims and drops empty entries from `tools:`", async () => {
    await withAgentsDir(
      { "messy.md": "---\ndescription: d\ntools: read_file,  list_dir ,\n---\nbody" },
      async (cwd) => {
        const agents = await loadSubagents(cwd, true, undefined);
        expect(agents.messy?.tools).toEqual(["read_file", "list_dir"]);
      },
    );
  });
});

describe("subagentToolWhitelist (M4-6)", () => {
  it("returns a Set for non-empty tools, undefined otherwise", () => {
    expect(subagentToolWhitelist(def({ tools: ["a", "b"] }))).toEqual(new Set(["a", "b"]));
    expect(subagentToolWhitelist(def({}))).toBeUndefined();
    expect(subagentToolWhitelist(def({ tools: [] }))).toBeUndefined();
  });
});

describe("withSubagentToolScope enforcement (M4-6)", () => {
  it("a read-only sub-agent has write/shell vetoed by the real checkToolWhitelist", async () => {
    await withSubagentToolScope(def({ tools: ["read_file"] }), async () => {
      expect(checkToolWhitelist("read_file").allowed).toBe(true);
      expect(checkToolWhitelist("write_file").allowed).toBe(false);
      expect(checkToolWhitelist("shell_exec").allowed).toBe(false);
    });
  });

  it("(EC-2) an unscoped (no tools) sub-agent is passthrough — parent unaffected", async () => {
    await withSubagentToolScope(def({}), async () => {
      expect(checkToolWhitelist("write_file").allowed).toBe(true);
    });
    await withSubagentToolScope(def({ tools: [] }), async () => {
      expect(checkToolWhitelist("shell_exec").allowed).toBe(true);
    });
  });

  it("returns the wrapped fn's value", async () => {
    const out = await withSubagentToolScope(def({ tools: ["read_file"] }), async () => 42);
    expect(out).toBe(42);
  });

  it("(EC-3) a nested scope shadows the outer set and restores it on return", async () => {
    await withSubagentToolScope(def({ tools: ["read_file"] }), async () => {
      expect(checkToolWhitelist("read_file").allowed).toBe(true);
      expect(checkToolWhitelist("list_dir").allowed).toBe(false);
      // inner child scoped to a DIFFERENT tool — shadows the outer set
      await withSubagentToolScope(def({ tools: ["list_dir"] }), async () => {
        expect(checkToolWhitelist("list_dir").allowed).toBe(true);
        expect(checkToolWhitelist("read_file").allowed).toBe(false);
      });
      // outer set restored after the child returns
      expect(checkToolWhitelist("read_file").allowed).toBe(true);
      expect(checkToolWhitelist("list_dir").allowed).toBe(false);
    });
  });

  it("(EC-4) tool names are exact-match: a case-mismatched whitelist blocks the canonical name", async () => {
    await withSubagentToolScope(def({ tools: ["Read_File"] }), async () => {
      // "Read_File" !== canonical "read_file" → the real tool is vetoed (documented contract)
      expect(checkToolWhitelist("read_file").allowed).toBe(false);
      expect(checkToolWhitelist("Read_File").allowed).toBe(true);
    });
  });
});

describe("@theokit/sdk/subagents subpath (M4-6 wiring)", () => {
  it("exposes the helpers and a read-only scope vetoes a real write/shell tool name", async () => {
    expect(typeof scopeFromSubpath).toBe("function");
    expect(whitelistFromSubpath(def({ tools: ["read_file"] }))).toEqual(new Set(["read_file"]));
    await scopeFromSubpath(def({ tools: ["read_file"] }), async () => {
      // write_file + shell_exec are real @theokit/sdk-tools tool names
      expect(checkToolWhitelist("write_file").allowed).toBe(false);
      expect(checkToolWhitelist("shell_exec").allowed).toBe(false);
      expect(checkToolWhitelist("read_file").allowed).toBe(true);
    });
  });
});
