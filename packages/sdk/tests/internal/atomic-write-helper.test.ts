/**
 * `atomicWriteText` — the write helper, on its own.
 *
 * These assertions used to ride along in the test for `theokit-migrate-config`, a CLI that
 * migrated a pre-2.0 config shape. The package is at 4.x and the CLI was removed; the
 * helper it happened to exercise was not, so its coverage moved here rather than leaving
 * with the binary.
 *
 * The fixture is rebuilt here rather than inherited: the original `beforeEach` also laid
 * out a `.theokit/` workspace for the CLI cases, and carrying that over would have kept a
 * setup for tests that no longer exist.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { atomicWriteText, replaceFileAtomic } from "../../src/internal/persistence/atomic-write.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomicWriteText helper (EC-2 fix)", () => {
  it("writes content atomically", async () => {
    const target = join(dir, "sub", "file.md");
    await atomicWriteText(target, "hello world");
    expect(readFileSync(target, "utf8")).toBe("hello world");
  });

  it("auto-creates parent dir", async () => {
    const target = join(dir, "a", "b", "c", "file.md");
    await atomicWriteText(target, "deep");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("deep");
  });

  it("replaceFileAtomic exists and works (legacy helper unchanged)", async () => {
    const target = join(dir, "legacy.md");
    await atomicWriteText(target, "first");
    await replaceFileAtomic(target, "second");
    expect(readFileSync(target, "utf8")).toBe("second");
  });
});
