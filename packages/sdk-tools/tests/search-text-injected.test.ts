import { type FileStat, FilesystemBackend } from "@theokit/sdk/filesystem";
import { describe, expect, it } from "vitest";

import { createSearchTextTool } from "../src/search-text.js";
import { textHandler } from "./text-handler.js";

class MemFs extends FilesystemBackend {
  constructor(
    private tree: Record<string, string[]>,
    private files: Map<string, string>,
  ) {
    super();
  }
  async list(path: string): Promise<string[]> {
    const t = this.tree[path];
    if (t === undefined) throw new Error("no dir");
    return t;
  }
  async stat(path: string): Promise<FileStat> {
    const isDirectory = this.tree[path] !== undefined;
    const c = this.files.get(path);
    if (!isDirectory && c === undefined) throw new Error("no path");
    return { size: c?.length ?? 0, mtimeMs: 0, isFile: c !== undefined, isDirectory };
  }
  async readFile(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error("ENOENT");
    return c;
  }
  async writeFile(): Promise<FileStat> {
    return { size: 0, mtimeMs: 0, isFile: true, isDirectory: false };
  }
}

describe("search_text — injected FilesystemBackend (surface-agnostic)", () => {
  const fs = () =>
    new MemFs(
      { "": ["src", "README.md"], src: ["a.ts", "b.ts"] },
      new Map([
        ["README.md", "title\nNEEDLE here\n"],
        ["src/a.ts", "const x = 1;\nconst NEEDLE = 2;\n"],
        ["src/b.ts", "nothing\n"],
      ]),
    );

  it("finds literal matches with project-relative file:line", async () => {
    const tool = createSearchTextTool({ projectRoot: "/nope", filesystem: fs() });
    const parsed = JSON.parse(await textHandler(tool)({ query: "NEEDLE" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.totalMatches).toBe(2);
    expect(parsed.matches).toContainEqual({ file: "README.md", line: 2, preview: "NEEDLE here" });
    expect(parsed.matches).toContainEqual({
      file: "src/a.ts",
      line: 2,
      preview: "const NEEDLE = 2;",
    });
  });

  it("scopes to a subdirectory", async () => {
    const tool = createSearchTextTool({ projectRoot: "/nope", filesystem: fs() });
    const parsed = JSON.parse(await textHandler(tool)({ query: "NEEDLE", path: "src" }));
    expect(parsed.matches).toEqual([{ file: "src/a.ts", line: 2, preview: "const NEEDLE = 2;" }]);
  });

  it("skips a binary file (null byte)", async () => {
    const tool = createSearchTextTool({
      projectRoot: "/nope",
      filesystem: new MemFs({ "": ["bin.dat"] }, new Map([["bin.dat", "NEE\u0000DLE"]])),
    });
    const parsed = JSON.parse(await textHandler(tool)({ query: "NEE" }));
    expect(parsed.totalMatches).toBe(0);
  });
});
