/**
 * A failed atomic write does not leave its temp behind.
 *
 * `replaceFileAtomic` opens `<file>.<pid>.<hex>.tmp`, writes, fsyncs, then renames. Cleanup existed for
 * exactly ONE of the ways that can fail: a rename error unlinked the temp, and a failure between the
 * open and the rename — a write error, a full disk, an fsync failure — closed the handle in a
 * `finally` and propagated, leaving the temp.
 *
 * How it was found, which is worth recording because nobody was looking for it: this package's suite
 * pollution gate reported a stray `.theokit/agents/registry.json.<pid>.<hex>.tmp` on two separate full
 * runs and not on the runs in between. A crash mid-write is unfixable from inside the process, but the
 * FAILED-write path is not a crash, and it was leaking by construction.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { replaceFileAtomic } from "../../../src/internal/persistence/atomic-write.js";

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("replaceFileAtomic — cleanup on a failed write", () => {
  it("leaves no temp behind when the write itself fails", async () => {
    dir = mkdtempSync(join(tmpdir(), "theokit-atomic-cleanup-"));
    const target = join(dir, "state.json");

    // A content value `writeFile` cannot serialise. It fails AFTER the temp is opened, which is the
    // window that had no cleanup — not the rename, which already had one.
    await expect(
      replaceFileAtomic(target, {
        toString: () => {
          throw new Error("boom");
        },
      } as unknown as string),
    ).rejects.toThrow();

    const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(
      leftovers,
      `a failed write left ${leftovers.length} temp file(s): ${leftovers.join(", ")}`,
    ).toEqual([]);
  });

  it("still cleans up when the rename fails — the path that already worked", async () => {
    dir = mkdtempSync(join(tmpdir(), "theokit-atomic-cleanup-"));
    // A directory where the file should go: rename onto a directory fails.
    const target = join(dir, "occupied");
    writeFileSync(join(dir, "sentinel"), "x");
    const asDir = join(dir, "occupied");
    rmSync(asDir, { force: true });
    // node:fs mkdirSync via writeFile is not available here; make the target a directory.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(asDir);

    await expect(replaceFileAtomic(target, "content")).rejects.toThrow();

    const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("writes the content when nothing fails", async () => {
    // The anti-vacuity case: if replaceFileAtomic were broken outright, the two above would pass by
    // rejecting for the wrong reason.
    dir = mkdtempSync(join(tmpdir(), "theokit-atomic-cleanup-"));
    const target = join(dir, "ok.json");
    await replaceFileAtomic(target, '{"a":1}');
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(target, "utf8")).toBe('{"a":1}');
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
