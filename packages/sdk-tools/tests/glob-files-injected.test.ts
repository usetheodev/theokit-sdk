import { type FileStat, FilesystemBackend } from "@theokit/sdk/filesystem";
import { describe, expect, it } from "vitest";

import { createGlobTool } from "../src/glob-files.js";
import { textHandler } from "./text-handler.js";

/** In-memory backend: `tree` maps a project-relative dir → its entries; `files` is the set of file paths.
 *  Proves glob_files walks via backend.list + backend.stat (project-relative), never the local fs. */
class MemFs extends FilesystemBackend {
  constructor(
    private readonly tree: Record<string, string[]>,
    private readonly files: Set<string>,
  ) {
    super();
  }
  async list(path: string): Promise<string[]> {
    const t = this.tree[path];
    if (t === undefined) throw new Error("no such dir");
    return t;
  }
  async stat(path: string): Promise<FileStat> {
    const isDirectory = this.tree[path] !== undefined;
    const isFile = this.files.has(path);
    if (!isDirectory && !isFile) throw new Error("no such path");
    return { size: 0, mtimeMs: 0, isFile, isDirectory };
  }
  async readFile(): Promise<string> {
    return "";
  }
  async writeFile(): Promise<FileStat> {
    return { size: 0, mtimeMs: 0, isFile: true, isDirectory: false };
  }
}

describe("glob_files — injected FilesystemBackend (surface-agnostic)", () => {
  const fs = () =>
    new MemFs(
      { "": ["src", "README.md"], src: ["a.ts", "b.json", "sub"], "src/sub": ["c.ts"] },
      new Set(["README.md", "src/a.ts", "src/b.json", "src/sub/c.ts"]),
    );

  it("finds files by pattern through the backend, project-relative", async () => {
    const tool = createGlobTool({ projectRoot: "/nope", filesystem: fs() });
    const parsed = JSON.parse(await textHandler(tool)({ pattern: "**/*.ts" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.files).toEqual(["src/a.ts", "src/sub/c.ts"]);
  });

  it("scopes to a cwd subdirectory (pattern relative to the cwd)", async () => {
    const tool = createGlobTool({ projectRoot: "/nope", filesystem: fs() });
    const parsed = JSON.parse(await textHandler(tool)({ pattern: "*.ts", cwd: "src" }));
    expect(parsed.files).toEqual(["src/a.ts"]); // c.ts is in src/sub, not matched by *.ts at src level
  });

  it("excludes node_modules/.git/dist/.theo", async () => {
    const tool = createGlobTool({
      projectRoot: "/nope",
      filesystem: new MemFs(
        { "": ["node_modules", "a.ts"], node_modules: ["junk.ts"] },
        new Set(["a.ts", "node_modules/junk.ts"]),
      ),
    });
    const parsed = JSON.parse(await textHandler(tool)({ pattern: "**/*.ts" }));
    expect(parsed.files).toEqual(["a.ts"]);
  });
});
