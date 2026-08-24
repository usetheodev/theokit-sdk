/**
 * Tests for context-import-resolver.ts (T2.1).
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { resolveImports } from "../../../src/internal/runtime/context/context-import-resolver.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

describe("resolveImports (T2.1)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "theokit-ctx-import-"));
    const __tmpCleanup1 = tmp;
    onTestFinished(async () => {
      await removeTempDirRobust(__tmpCleanup1);
    });
  });
  afterEach(() => {});

  it("single import resolves content", async () => {
    await writeFile(join(tmp, "child.md"), "child content");
    const out = await resolveImports("before\n@child.md\nafter", join(tmp, "root.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 1000,
    });
    expect(out).toContain("child content");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("nested import resolves recursively", async () => {
    await writeFile(join(tmp, "child.md"), "@grandchild.md");
    await writeFile(join(tmp, "grandchild.md"), "deepest");
    const out = await resolveImports("@child.md", join(tmp, "root.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 1000,
    });
    expect(out).toContain("deepest");
  });

  it("5-hop depth limit emits marker (EC-13)", async () => {
    // chain: root → a → b → c → d → e → f (6 levels, blows past 5-hop)
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      await writeFile(join(tmp, `${name}.md`), `level ${name}`);
    }
    await writeFile(join(tmp, "a.md"), "@b.md");
    await writeFile(join(tmp, "b.md"), "@c.md");
    await writeFile(join(tmp, "c.md"), "@d.md");
    await writeFile(join(tmp, "d.md"), "@e.md");
    await writeFile(join(tmp, "e.md"), "@f.md");
    await writeFile(join(tmp, "f.md"), "final");
    const out = await resolveImports("@a.md", join(tmp, "root.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 1000,
    });
    expect(out).toMatch(/@import depth limit 5 reached/);
  });

  it("cycle detected emits marker (EC-11)", async () => {
    await writeFile(join(tmp, "a.md"), "@b.md");
    await writeFile(join(tmp, "b.md"), "@a.md");
    const out = await resolveImports("@a.md", join(tmp, "root.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 1000,
    });
    expect(out).toContain("cycle detected");
  });

  it("diamond import resolves once per file (EC-12)", async () => {
    await writeFile(join(tmp, "a.md"), "AAA");
    const out = await resolveImports("@a.md\n\n@a.md", join(tmp, "root.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 1000,
    });
    expect(out.match(/cycle detected/g)?.length).toBe(1);
  });

  it("missing import emits placeholder", async () => {
    const out = await resolveImports("@missing.md", join(tmp, "root.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 1000,
    });
    expect(out).toContain("@import not found");
  });

  it("relative import resolves against importer dir", async () => {
    await mkdir(join(tmp, "sub"), { recursive: true });
    await writeFile(join(tmp, "sub", "child.md"), "in-sub");
    const out = await resolveImports("@child.md", join(tmp, "sub", "parent.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 1000,
    });
    expect(out).toContain("in-sub");
  });

  it("absolute import resolves verbatim", async () => {
    const abs = join(tmp, "abs.md");
    await writeFile(abs, "absolute-content");
    const out = await resolveImports(`@${abs}`, join(tmp, "root.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 1000,
    });
    expect(out).toContain("absolute-content");
  });

  it("tilde expansion to homedir", async () => {
    // We mock homedir via env to a known location for safety.
    const original = process.env.HOME;
    process.env.HOME = tmp; // node:os homedir reads $HOME on POSIX
    try {
      await writeFile(join(tmp, "globalish.md"), "global-content");
      const out = await resolveImports("@~/globalish.md", join(tmp, "root.md"), {
        visited: new Set(),
        depth: 0,
        maxBytesPerFile: 1000,
      });
      expect(out).toContain("global-content");
    } finally {
      if (original !== undefined) process.env.HOME = original;
      else delete process.env.HOME;
    }
  });

  it("empty import returns empty content (EC-16)", async () => {
    await writeFile(join(tmp, "empty.md"), "");
    const out = await resolveImports("before\n@empty.md\nafter", join(tmp, "root.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 1000,
    });
    expect(out).toBe("before\n\nafter");
  });

  // EC-D: per-import truncation
  it("EC-D: imported file capped at maxBytesPerFile", async () => {
    await writeFile(join(tmp, "huge.md"), "x".repeat(10_000));
    const out = await resolveImports("@huge.md", join(tmp, "root.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 500, // tight cap
    });
    expect(out.length).toBeLessThan(1000); // way under the 10k unimported
    expect(out).toContain("[truncated by theokit]");
  });

  // EC-Q: inline @path not on own line is NOT resolved
  it("EC-Q: inline @path not on own line is not resolved", async () => {
    await writeFile(join(tmp, "a.md"), "should-not-import");
    const out = await resolveImports("see @a.md, also @a.md", join(tmp, "root.md"), {
      visited: new Set(),
      depth: 0,
      maxBytesPerFile: 1000,
    });
    expect(out).toBe("see @a.md, also @a.md");
    expect(out).not.toContain("should-not-import");
  });
});
