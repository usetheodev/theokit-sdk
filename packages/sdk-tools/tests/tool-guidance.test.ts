import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CustomTool } from "@theokit/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TOOL_GUIDANCE,
  injectGuidance,
  withDefaultGuidance,
  withShellExitGuidance,
  withToolResultGuidance,
} from "../src/internal/tool-guidance.js";
import { createReadFileTool } from "../src/read-file.js";
import { textHandler } from "./_text-handler.js";

const fakeTool = (name: string, output: string): CustomTool => ({
  name,
  description: "x",
  inputSchema: { type: "object" },
  handler: async () => output,
});

describe("withShellExitGuidance — shell_exec ok:true soft failure", () => {
  it("adds guidance on a non-zero exit_code", async () => {
    const t = withShellExitGuidance(
      fakeTool("shell_exec", '{"ok":true,"stderr":"boom","exit_code":2}'),
    );
    const r = JSON.parse(await textHandler(t)({}));
    expect(r.guidance).toMatch(/exit/i);
    expect(r.guidance).toMatch(/2/);
  });
  it("is a no-op on exit_code 0 (even with json-ish stdout)", async () => {
    const ok = '{"ok":true,"stdout":"{\\"ok\\":false}","exit_code":0}';
    expect(await withShellExitGuidance(fakeTool("shell_exec", ok)).handler({})).toBe(ok);
  });
  it("is a no-op for non-shell tools", async () => {
    const failed = '{"ok":false,"error":"no_match"}';
    expect(await withShellExitGuidance(fakeTool("edit_file", failed)).handler({})).toBe(failed);
  });
  it("is idempotent when guidance already present", async () => {
    const withG = '{"ok":true,"exit_code":1,"guidance":"keep me"}';
    expect(
      JSON.parse(await textHandler(withShellExitGuidance(fakeTool("shell_exec", withG)))({}))
        .guidance,
    ).toBe("keep me");
  });
  it("never throws on non-JSON output", async () => {
    const garbage = "not json <<<";
    expect(await withShellExitGuidance(fakeTool("shell_exec", garbage)).handler({})).toBe(garbage);
  });
  it("preserves the wrapped tool's name/description/inputSchema", () => {
    const base = fakeTool("shell_exec", "{}");
    const wrapped = withShellExitGuidance(base);
    expect(wrapped.name).toBe(base.name);
    expect(wrapped.description).toBe(base.description);
    expect(wrapped.inputSchema).toEqual(base.inputSchema);
  });
});

const MAP = { not_found: "use list_dir to find the path" };

describe("injectGuidance — additive on ok:false", () => {
  it("adds guidance for a known error code", () => {
    const parsed = JSON.parse(injectGuidance('{"ok":false,"error":"not_found"}', MAP));
    expect(parsed.guidance).toBe("use list_dir to find the path");
  });

  it("preserves the other fields of the payload", () => {
    const parsed = JSON.parse(injectGuidance('{"ok":false,"error":"not_found","path":"/x"}', MAP));
    expect(parsed.path).toBe("/x");
    expect(parsed.guidance).toBe("use list_dir to find the path");
  });
});

describe("injectGuidance — passthrough (never-throw)", () => {
  it("leaves an ok:true result unchanged", () => {
    const input = '{"ok":true,"content":"x"}';
    expect(injectGuidance(input, MAP)).toBe(input);
  });

  it("returns unchanged for an unknown error code", () => {
    const input = '{"ok":false,"error":"weird"}';
    expect(injectGuidance(input, MAP)).toBe(input);
  });

  it("passes through non-JSON output verbatim (no throw)", () => {
    expect(() => injectGuidance("not json at all", MAP)).not.toThrow();
    expect(injectGuidance("not json at all", MAP)).toBe("not json at all");
  });

  it("passes through valid-but-non-object JSON (array/null/number) (EC-1)", () => {
    expect(injectGuidance("[1,2]", MAP)).toBe("[1,2]");
    expect(injectGuidance("null", MAP)).toBe("null");
    expect(injectGuidance("5", MAP)).toBe("5");
  });

  it("preserves an existing guidance field (idempotent)", () => {
    const input = '{"ok":false,"error":"not_found","guidance":"mine"}';
    expect(injectGuidance(input, MAP)).toBe(input);
  });

  it("preserves a non-string existing guidance (never touches the key)", () => {
    const input = '{"ok":false,"error":"not_found","guidance":123}';
    expect(injectGuidance(input, MAP)).toBe(input);
  });

  it("passes through when ok is absent or non-boolean (only strict false triggers)", () => {
    expect(injectGuidance('{"error":"not_found"}', MAP)).toBe('{"error":"not_found"}');
    expect(injectGuidance('{"ok":0,"error":"not_found"}', MAP)).toBe(
      '{"ok":0,"error":"not_found"}',
    );
  });
});

describe("DEFAULT_TOOL_GUIDANCE", () => {
  it("covers the common cross-tool error codes (each actually emitted by a tool)", () => {
    for (const code of [
      "not_found",
      "no_match",
      "timeout",
      "invalid_url",
      "ssrf_blocked",
      "catastrophic_command",
    ]) {
      expect(typeof DEFAULT_TOOL_GUIDANCE[code]).toBe("string");
    }
  });

  it("has no hint for a code no tool emits (no dead hints)", () => {
    expect(DEFAULT_TOOL_GUIDANCE.no_matches).toBeUndefined();
  });
});

describe("withToolResultGuidance / withDefaultGuidance", () => {
  it("preserves the wrapped tool's name/description/inputSchema", () => {
    const base = createReadFileTool({ projectRoot: "/tmp" });
    const wrapped = withToolResultGuidance(base, MAP);
    expect(wrapped.name).toBe(base.name);
    expect(wrapped.description).toBe(base.description);
    expect(wrapped.inputSchema).toEqual(base.inputSchema);
  });

  describe("integration against a real built-in tool", () => {
    let projectRoot: string;
    beforeEach(() => {
      projectRoot = mkdtempSync(join(tmpdir(), "sdk-guidance-"));
    });
    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
    });

    it("injects guidance on a real failing read_file (not_found)", async () => {
      const tool = withDefaultGuidance(createReadFileTool({ projectRoot }));
      const parsed = JSON.parse(await textHandler(tool)({ path: "nope.txt" }));
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBe("not_found");
      expect(typeof parsed.guidance).toBe("string");
    });

    it("passes a successful read_file through without guidance", async () => {
      writeFileSync(join(projectRoot, "hi.txt"), "hello");
      const tool = withDefaultGuidance(createReadFileTool({ projectRoot }));
      const parsed = JSON.parse(await textHandler(tool)({ path: "hi.txt" }));
      expect(parsed.ok).toBe(true);
      expect(parsed.guidance).toBeUndefined();
    });

    it("flows a CUSTOM guidance map end-to-end through the wrapper", async () => {
      const tool = withToolResultGuidance(createReadFileTool({ projectRoot }), MAP);
      const parsed = JSON.parse(await textHandler(tool)({ path: "nope.txt" }));
      expect(parsed.guidance).toBe("use list_dir to find the path");
    });
  });

  it("works for a synchronous-handler tool (await resolves a plain string)", async () => {
    const syncTool = {
      name: "sync_tool",
      description: "sync",
      inputSchema: { type: "object" } as Record<string, unknown>,
      handler: () => '{"ok":false,"error":"not_found"}',
    };
    const parsed = JSON.parse(await textHandler(withDefaultGuidance(syncTool))({}));
    expect(typeof parsed.guidance).toBe("string");
  });
});

describe("sdk-tools barrel — tool-guidance", () => {
  it("re-exports the guidance wrappers and map", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.withToolResultGuidance).toBe("function");
    expect(typeof mod.withDefaultGuidance).toBe("function");
    expect(typeof mod.withShellExitGuidance).toBe("function");
    expect(typeof mod.injectGuidance).toBe("function");
    expect(typeof mod.DEFAULT_TOOL_GUIDANCE).toBe("object");
  });
});
