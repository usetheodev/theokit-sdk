/**
 * Regression tests for two defects the M15 adversarial review surfaced on the INJECTED fs path:
 *  1. Backend walk follows symlinks (stat-based) and could recurse forever on an in-boundary symlink
 *     cycle → now depth-capped (MAX_BACKEND_WALK_DEPTH) so it terminates.
 *  2. edit_file's backend read mapped EVERY failure to `not_found`; now only a missing file maps to
 *     `not_found` (FileNotFoundError) and any other read error (e.g. a directory) propagates (fail-loud).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemError, LocalFilesystem } from "@theokit/sdk/filesystem";
import { afterEach, describe, expect, it } from "vitest";

import { createEditFileTool } from "../src/edit-file.js";
import { createGlobTool } from "../src/glob-files.js";
import { createSearchTextTool } from "../src/search-text.js";
import { textHandler } from "./text-handler.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function symlinkFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "fs-symlink-"));
  roots.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "const NEEDLE = 1;\n");
  // In-boundary symlink cycle: src/loop -> src. Stays under basePath, so it is NOT a security escape,
  // but a stat-based walk would recurse src/loop/loop/loop/… forever without the depth cap.
  symlinkSync(join(root, "src"), join(root, "src", "loop"));
  return root;
}

describe("M15 review fix — backend walk terminates on an in-boundary symlink cycle", () => {
  it("glob_files completes (does not hang) and still finds the real file", async () => {
    const root = symlinkFixture();
    const tool = createGlobTool({
      projectRoot: root,
      filesystem: new LocalFilesystem({ basePath: root }),
    });
    const parsed = JSON.parse(await textHandler(tool)({ pattern: "**/*.ts" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.files).toContain("src/a.ts");
    expect(parsed.count).toBeLessThan(200); // bounded — no PATH_MAX explosion
  });

  it("search_text completes (does not hang) on the same cycle", async () => {
    const root = symlinkFixture();
    const tool = createSearchTextTool({
      projectRoot: root,
      filesystem: new LocalFilesystem({ basePath: root }),
    });
    const parsed = JSON.parse(await textHandler(tool)({ query: "NEEDLE" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.totalMatches).toBeGreaterThanOrEqual(1);
  });
});

describe("M15 review fix — edit_file backend classifies read failures like the local path", () => {
  it("returns not_found for a genuinely missing file", async () => {
    const root = mkdtempSync(join(tmpdir(), "fs-edit-"));
    roots.push(root);
    const tool = createEditFileTool({
      projectRoot: root,
      filesystem: new LocalFilesystem({ basePath: root }),
    });
    const parsed = JSON.parse(
      await textHandler(tool)({ path: "missing.ts", old_string: "a", new_string: "b" }),
    );
    expect(parsed).toEqual({ ok: false, error: "not_found", path: "missing.ts" });
  });

  it("does NOT swallow a directory read as not_found — the error propagates (fail-loud)", async () => {
    const root = mkdtempSync(join(tmpdir(), "fs-edit-dir-"));
    roots.push(root);
    mkdirSync(join(root, "plaindir"));
    const tool = createEditFileTool({
      projectRoot: root,
      filesystem: new LocalFilesystem({ basePath: root }),
    });
    // Reading a directory is not "file missing" — it must not masquerade as not_found.
    // B-079 — was bare `.rejects.toThrow()`. `LocalFilesystem.readFile`'s
    // `mapError` (local-filesystem.ts:159) wraps every non-ENOENT failure —
    // including EISDIR — in the typed `FilesystemError`, code `filesystem_io`,
    // specifically so a raw Node `SystemError` never leaks (per Rule 8).
    await expect(
      textHandler(tool)({ path: "plaindir", old_string: "a", new_string: "b" }),
    ).rejects.toThrow(FilesystemError);
    await expect(
      textHandler(tool)({ path: "plaindir", old_string: "a", new_string: "b" }),
    ).rejects.toMatchObject({ code: "filesystem_io" });
  });
});
