import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSearchTextTool } from "../../src/tools/search-text.js";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "sdk-search-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createSearchTextTool — tool shape", () => {
  it("Given the factory, Then it returns a CustomTool with name='search_text'", () => {
    const tool = createSearchTextTool({ projectRoot });
    expect(tool.name).toBe("search_text");
    expect(typeof tool.handler).toBe("function");
  });
});

describe("createSearchTextTool — happy path", () => {
  it("Given a literal query matched in 2 files, Then 2 matches are returned with file + line", async () => {
    writeFileSync(join(projectRoot, "a.ts"), "import { foo } from './bar'");
    writeFileSync(join(projectRoot, "b.ts"), "const x = foo()");
    writeFileSync(join(projectRoot, "c.ts"), "// no match here");
    const tool = createSearchTextTool({ projectRoot });
    const out = await tool.handler({ query: "foo" });
    const parsed = JSON.parse(out) as {
      ok: boolean;
      matches: Array<{ file: string; line: number; preview: string }>;
      truncated: boolean;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.matches.length).toBe(2);
    const files = parsed.matches.map((m) => m.file).sort();
    expect(files).toEqual(["a.ts", "b.ts"]);
    for (const m of parsed.matches) {
      expect(m.line).toBeGreaterThan(0);
      expect(m.preview).toContain("foo");
    }
  });

  it("Given a query with no matches, Then matches=[] and ok=true", async () => {
    writeFileSync(join(projectRoot, "a.ts"), "hello");
    const tool = createSearchTextTool({ projectRoot });
    const out = await tool.handler({ query: "nonexistent-xyz" });
    const parsed = JSON.parse(out) as { ok: boolean; matches: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.matches).toEqual([]);
  });

  it("Given a nested file structure, Then it recurses into subdirectories", async () => {
    mkdirSync(join(projectRoot, "src"));
    writeFileSync(join(projectRoot, "src", "deep.ts"), "needle here");
    const tool = createSearchTextTool({ projectRoot });
    const out = await tool.handler({ query: "needle" });
    const parsed = JSON.parse(out) as { ok: boolean; matches: Array<{ file: string }> };
    expect(parsed.ok).toBe(true);
    expect(parsed.matches[0]?.file).toBe(join("src", "deep.ts"));
  });
});

describe("createSearchTextTool — search scope", () => {
  it("Given a path scope, Then only files under that path are searched", async () => {
    mkdirSync(join(projectRoot, "app"));
    mkdirSync(join(projectRoot, "lib"));
    writeFileSync(join(projectRoot, "app", "a.ts"), "needle");
    writeFileSync(join(projectRoot, "lib", "b.ts"), "needle");
    const tool = createSearchTextTool({ projectRoot });
    const out = await tool.handler({ query: "needle", path: "app" });
    const parsed = JSON.parse(out) as { matches: Array<{ file: string }> };
    expect(parsed.matches.length).toBe(1);
    expect(parsed.matches[0]?.file.startsWith("app")).toBe(true);
  });

  it("Given forbidden dirs in the tree, Then they are NOT searched", async () => {
    mkdirSync(join(projectRoot, "node_modules"));
    writeFileSync(join(projectRoot, "node_modules", "noise.js"), "needle");
    mkdirSync(join(projectRoot, ".git"));
    writeFileSync(join(projectRoot, ".git", "config"), "needle");
    writeFileSync(join(projectRoot, "real.ts"), "needle");
    const tool = createSearchTextTool({ projectRoot });
    const out = await tool.handler({ query: "needle" });
    const parsed = JSON.parse(out) as { matches: Array<{ file: string }> };
    expect(parsed.matches.length).toBe(1);
    expect(parsed.matches[0]?.file).toBe("real.ts");
  });
});

describe("createSearchTextTool — safety boundaries", () => {
  it("Given path traversal in the scope, Then error='path_traversal'", async () => {
    const tool = createSearchTextTool({ projectRoot });
    const out = await tool.handler({ query: "x", path: "../etc" });
    const parsed = JSON.parse(out) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("path_traversal");
  });
});

describe("createSearchTextTool — output caps", () => {
  it("Given more matches than the max, Then result is truncated", async () => {
    for (let i = 0; i < 150; i += 1) {
      writeFileSync(join(projectRoot, `f${i}.ts`), "needle");
    }
    const tool = createSearchTextTool({ projectRoot, maxMatches: 50 });
    const out = await tool.handler({ query: "needle" });
    const parsed = JSON.parse(out) as { matches: unknown[]; truncated: boolean };
    expect(parsed.matches).toHaveLength(50);
    expect(parsed.truncated).toBe(true);
  });
});
