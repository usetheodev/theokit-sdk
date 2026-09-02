import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import { listMarkdownIn } from "../../../src/internal/memory/storage/list-markdown.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";

/**
 * One helper replacing three near-copies (`discoverWikiFiles`, `discoverSessionFiles`,
 * `markdownFilesIn`). Two of the three swallowed EVERY readdir failure and hand-rolled the relative
 * path by slicing `${root}/` off the front — wrong for anything not under root, and wrong on any
 * platform whose separator is not `/`. This pins the behaviour the merged version claims.
 */
describe("listMarkdownIn", () => {
  function workspace(): { root: string; dir: string } {
    const root = mkdtempSync(join(tmpdir(), "list-md-"));
    onTestFinished(() => {
      removeTempDirRobustSync(root);
    });
    const dir = join(root, "wiki");
    mkdirSync(dir, { recursive: true });
    return { root, dir };
  }

  it("returns markdown only, with paths relative to the root", async () => {
    const { root, dir } = workspace();
    writeFileSync(join(dir, "a.md"), "#");
    writeFileSync(join(dir, "b.md"), "#");
    writeFileSync(join(dir, "notes.txt"), "x");

    const files = await listMarkdownIn(dir, root);

    expect(files.map((f) => f.relPath).sort()).toEqual([
      join("wiki", "a.md"),
      join("wiki", "b.md"),
    ]);
    expect(files.every((f) => f.absolutePath.startsWith(dir))).toBe(true);
  });

  it("treats a missing directory as an empty corpus, not a failure", async () => {
    const { root } = workspace();
    await expect(listMarkdownIn(join(root, "never-created"), root)).resolves.toEqual([]);
  });

  it("honours the skip list", async () => {
    const { root, dir } = workspace();
    writeFileSync(join(dir, "MEMORY.md"), "#");
    writeFileSync(join(dir, "keep.md"), "#");

    const files = await listMarkdownIn(dir, root, { skip: ["MEMORY.md"] });

    expect(files.map((f) => f.relPath)).toEqual([join("wiki", "keep.md")]);
  });

  it("PROPAGATES a read failure that is not absence", async () => {
    // The behaviour the three copies did not have: they caught everything, so an unreadable
    // directory reported as an empty corpus and the index silently went stale. A permissions error
    // is not "nothing indexed yet".
    const { root, dir } = workspace();
    writeFileSync(join(dir, "a.md"), "#");
    chmodSync(dir, 0o000);
    onTestFinished(() => {
      chmodSync(dir, 0o755);
    });

    // Root ignores the mode bits, so this assertion would be vacuous there.
    if (process.getuid?.() === 0) return;

    await expect(listMarkdownIn(dir, root)).rejects.toMatchObject({ code: "EACCES" });
  });
});
