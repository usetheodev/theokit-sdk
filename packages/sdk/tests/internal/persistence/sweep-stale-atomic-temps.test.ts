/**
 * The stale-temp sweeper, and the 23% it must admit it cannot claim.
 *
 * `atomicWriteTempTarget` was exported so a consumer could collect leftover
 * `<file>.<pid>.<hex>.tmp` files — its own docblock said so — and no consumer ever existed. Measured
 * 2026-09-01: `packages/sdk/.theokit/agents/` held **1,984** of them, spanning 2026-05-16 to that
 * morning. Each is a complete, well-formed write that never got renamed, which is process death
 * between the two steps rather than a corrupt write path.
 *
 * The half that decided this file's shape: of those 1,984, only **1,522** matched the current
 * `<pid>.<16-hex>.tmp` form. The other 462 carried an older suffix from before the format changed. A
 * sweeper that knows only today's format would run, report success, and leave 23% behind with no way
 * to know it did. So `sweepStaleAtomicTemps` returns what it SKIPPED, and these cases assert that it
 * does — an under-collecting cleanup is worse than an absent one, because the absence is at least
 * visible on disk.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sweepStaleAtomicTemps } from "../../../src/internal/persistence/atomic-write.js";

let dir: string;
let target: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "theokit-sweep-"));
  target = join(dir, "registry.json");
  await writeFile(target, "{}");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("sweepStaleAtomicTemps", () => {
  it("removes temps in the current format", async () => {
    await writeFile(`${target}.1234.0123456789abcdef.tmp`, "x");
    await writeFile(`${target}.9999.fedcba9876543210.tmp`, "x");

    const { removed, skipped } = await sweepStaleAtomicTemps(target);
    expect(removed).toBe(2);
    expect(skipped).toEqual([]);
    expect(await readdir(dir)).toEqual(["registry.json"]);
  });

  it("REPORTS an older-format temp instead of silently leaving it", async () => {
    // The exact shape found on disk: `registry.json.1002067.msvhdley.tmp` — a non-hex suffix that
    // predates the current format. 462 of the 1,984 looked like this.
    await writeFile(`${target}.1002067.msvhdley.tmp`, "x");

    const { removed, skipped } = await sweepStaleAtomicTemps(target);
    expect(removed, "it must not claim a file it did not recognise").toBe(0);
    expect(
      skipped,
      "a sweeper that under-collects in silence is the failure this return value exists to prevent",
    ).toEqual(["registry.json.1002067.msvhdley.tmp"]);
    // And it is still there — reported, not deleted by a wildcard.
    expect(await readdir(dir)).toContain("registry.json.1002067.msvhdley.tmp");
  });

  it("never touches a temp belonging to another file", async () => {
    await writeFile(join(dir, "other.json.1234.0123456789abcdef.tmp"), "x");
    const { removed, skipped } = await sweepStaleAtomicTemps(target);
    expect(removed).toBe(0);
    expect(skipped).toEqual([]);
    expect(await readdir(dir)).toContain("other.json.1234.0123456789abcdef.tmp");
  });

  it("never touches an unrelated .tmp on the same path", async () => {
    // The strictness the pattern's own docblock argues for: this directory is shared, and a
    // wildcard `.tmp` remover would claim editors' swap files and other tools' scratch.
    await writeFile(join(dir, "registry.json.swp.tmp"), "x");
    const { removed } = await sweepStaleAtomicTemps(target);
    expect(removed).toBe(0);
    expect(await readdir(dir)).toContain("registry.json.swp.tmp");
  });

  it("is a no-op on a directory that does not exist", async () => {
    const { removed, skipped } = await sweepStaleAtomicTemps(join(dir, "nope", "registry.json"));
    expect(removed).toBe(0);
    expect(skipped).toEqual([]);
  });
});
