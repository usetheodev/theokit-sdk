import { FileNotFoundError, type FileStat, FilesystemBackend } from "@theokit/sdk/filesystem";
import { describe, expect, it } from "vitest";

import { createEditFileTool } from "../src/edit-file.js";
import { textHandler } from "./text-handler.js";

/** In-memory backend recording every write — proves edit_file reads/backs-up/writes through the backend. */
class MemFs extends FilesystemBackend {
  writes: Array<{ path: string; content: string }> = [];
  constructor(private files: Map<string, string>) {
    super();
  }
  async readFile(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new FileNotFoundError(path);
    return c;
  }
  async writeFile(path: string, content: string): Promise<FileStat> {
    this.writes.push({ path, content });
    this.files.set(path, content);
    return { size: content.length, mtimeMs: 0, isFile: true, isDirectory: false };
  }
  async stat(): Promise<FileStat> {
    return { size: 0, mtimeMs: 0, isFile: true, isDirectory: false };
  }
  async list(): Promise<string[]> {
    return [];
  }
}

describe("edit_file — injected FilesystemBackend (surface-agnostic)", () => {
  it("edits via the backend, writes a .bak backup then the result", async () => {
    const fs = new MemFs(new Map([["src/a.ts", "const x = 1;\n"]]));
    const tool = createEditFileTool({ projectRoot: "/nope", filesystem: fs });
    const parsed = JSON.parse(
      await textHandler(tool)({
        path: "src/a.ts",
        old_string: "const x = 1;",
        new_string: "const x = 2;",
      }),
    );
    expect(parsed).toEqual({ ok: true, replacements: 1 });
    // .bak holds the ORIGINAL, then the file holds the edited result — in that order.
    expect(fs.writes).toEqual([
      { path: "src/a.ts.bak", content: "const x = 1;\n" },
      { path: "src/a.ts", content: "const x = 2;\n" },
    ]);
  });

  it("returns not_found when the backend has no such file", async () => {
    const fs = new MemFs(new Map());
    const tool = createEditFileTool({ projectRoot: "/nope", filesystem: fs });
    const parsed = JSON.parse(
      await textHandler(tool)({ path: "src/missing.ts", old_string: "a", new_string: "b" }),
    );
    expect(parsed).toEqual({ ok: false, error: "not_found", path: "src/missing.ts" });
    expect(fs.writes).toEqual([]); // no write, no .bak on a missing file
  });

  it("returns no_match (no write) when old_string is absent", async () => {
    const fs = new MemFs(new Map([["a.ts", "hello\n"]]));
    const tool = createEditFileTool({ projectRoot: "/nope", filesystem: fs });
    const parsed = JSON.parse(
      await textHandler(tool)({ path: "a.ts", old_string: "zzz", new_string: "b" }),
    );
    expect(parsed).toEqual({ ok: false, error: "no_match", path: "a.ts" });
    expect(fs.writes).toEqual([]);
  });

  it("rejects a traversal path before touching the backend", async () => {
    const fs = new MemFs(new Map());
    const tool = createEditFileTool({ projectRoot: "/nope", filesystem: fs });
    const parsed = JSON.parse(
      await textHandler(tool)({ path: "../escape.ts", old_string: "a", new_string: "b" }),
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("path_traversal");
    expect(fs.writes).toEqual([]);
  });
});
