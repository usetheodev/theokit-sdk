/**
 * RED tests for T2.2 — `withFileLock` cross-process via proper-lockfile + fallback.
 * Includes EC-1 (companion lockfile works on non-existent paths).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetFileLockCacheForTesting,
  withFileLock,
} from "../../../src/internal/persistence/file-lock.js";

describe("withFileLock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "file-lock-test-"));
    _resetFileLockCacheForTesting();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serializes concurrent calls (counter consistency)", async () => {
    const path = join(dir, "counter.json");
    writeFileSync(path, '{"n":0}');
    let counter = 0;

    await Promise.all(
      Array.from({ length: 20 }, () =>
        withFileLock(path, async () => {
          const current = counter;
          await new Promise((resolve) => setTimeout(resolve, 1));
          counter = current + 1;
        }),
      ),
    );

    expect(counter).toBe(20);
  });

  it("releases lock when fn throws (next acquire succeeds)", async () => {
    const path = join(dir, "throw.json");
    writeFileSync(path, "data");

    await expect(
      withFileLock(path, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // If lock was leaked we'd hang here forever — test timeout catches.
    let acquired = false;
    await withFileLock(path, async () => {
      acquired = true;
    });
    expect(acquired).toBe(true);
  });

  it("EC-1: works when target path does not exist (companion lockfile)", async () => {
    const path = join(dir, "does-not-exist-yet.json");
    let ran = false;
    await withFileLock(path, async () => {
      ran = true;
      // Now create the file (lock-then-create pattern).
      writeFileSync(path, '{"created":true}');
    });
    expect(ran).toBe(true);
  });

  it("returns fn's value", async () => {
    const path = join(dir, "ret.json");
    writeFileSync(path, "data");
    const result = await withFileLock(path, async () => "answer");
    expect(result).toBe("answer");
  });

  it("respects retries on busy lock", async () => {
    const path = join(dir, "busy.json");
    writeFileSync(path, "data");

    // Acquire and hold a long lock, then try to acquire from another caller.
    let firstReleased = false;
    const firstPromise = withFileLock(path, async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      firstReleased = true;
    });

    const secondPromise = withFileLock(
      path,
      async () => {
        expect(firstReleased).toBe(true);
        return "second";
      },
      { retries: 10 },
    );

    await firstPromise;
    expect(await secondPromise).toBe("second");
  });
});
