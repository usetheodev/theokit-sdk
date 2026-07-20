/**
 * Conformance: the injected FilesystemProvider path (backed by the real `LocalFilesystem`) must produce
 * output IDENTICAL to the local `fs` path for glob_files / search_text / edit_file. This is the
 * end-to-end backward-compatibility proof — same fixture on disk, both code paths, byte-identical result.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFilesystem } from "@theokit/sdk/filesystem";
import { afterEach, describe, expect, it } from "vitest";

import { createEditFileTool } from "../src/edit-file.js";
import { createGlobTool } from "../src/glob-files.js";
import { createSearchTextTool } from "../src/search-text.js";
import { textHandler } from "./text-handler.js";

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "fs-conformance-"));
  roots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "src", "sub"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# title\nNEEDLE at top\n");
  writeFileSync(join(root, "src", "a.ts"), "const x = 1;\nconst NEEDLE = 2;\n");
  writeFileSync(join(root, "src", "sub", "c.ts"), "export const c = 3;\n");
  return root;
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("fs-injection conformance — local path === injected LocalFilesystem path", () => {
  it("glob_files: identical output with and without injection", async () => {
    const root = fixture();
    const local = createGlobTool({ projectRoot: root });
    const injected = createGlobTool({
      projectRoot: root,
      filesystem: new LocalFilesystem({ basePath: root }),
    });
    const args = { pattern: "**/*.ts" };
    expect(await textHandler(injected)(args)).toBe(await textHandler(local)(args));
  });

  it("search_text: identical output with and without injection", async () => {
    const root = fixture();
    const local = createSearchTextTool({ projectRoot: root });
    const injected = createSearchTextTool({
      projectRoot: root,
      filesystem: new LocalFilesystem({ basePath: root }),
    });
    const args = { query: "NEEDLE" };
    expect(await textHandler(injected)(args)).toBe(await textHandler(local)(args));
  });

  it("edit_file: identical result JSON and identical on-disk content", async () => {
    const rootLocal = fixture();
    const rootInj = fixture();
    const local = createEditFileTool({ projectRoot: rootLocal });
    const injected = createEditFileTool({
      projectRoot: rootInj,
      filesystem: new LocalFilesystem({ basePath: rootInj }),
    });
    const args = {
      path: "src/a.ts",
      old_string: "const NEEDLE = 2;",
      new_string: "const NEEDLE = 42;",
    };
    const resLocal = await textHandler(local)(args);
    const resInj = await textHandler(injected)(args);
    expect(resInj).toBe(resLocal);
    expect(readFileSync(join(rootInj, "src", "a.ts"), "utf-8")).toBe(
      readFileSync(join(rootLocal, "src", "a.ts"), "utf-8"),
    );
    // Both paths leave a .bak with the pre-edit content.
    expect(readFileSync(join(rootInj, "src", "a.ts.bak"), "utf-8")).toBe(
      readFileSync(join(rootLocal, "src", "a.ts.bak"), "utf-8"),
    );
  });
});
