import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { expectScopeCovered } from "./_scope-sentinel.js";

const TESTS_ROOT = join(__dirname, "..");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const { readdir, stat } = await import("node:fs/promises");
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else if (full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Any of the ways this suite removes a directory it created. */
const CLEANS_UP = /removeTempDirRobust|createTempWorkspace|useTempCwd|\brmSync\s*\(|\brm\s*\(/;
const CREATES = /\bmkdtemp(Sync)?\s*\(/;

/**
 * A test that creates a temp directory and removes nothing leaks one per `beforeEach`, forever.
 *
 * `tests/helpers/temp-workspace.ts` exists for this and its own B-082 docblock records the sweep that
 * found it: "51+ additional files across tests/** calling mkdtemp/mkdtempSync directly and never
 * removing the directory at all". The migration stalled — 16 files still created and never removed,
 * and nothing detected the regression.
 *
 * Measured 2026-09-02 before the fix: 3,660 directories under /tmp carried the 32 prefixes those 16
 * files use, and a run of just two of them added 10 more. After: 0.
 *
 * WHAT THIS DOES NOT CHECK: that the cleanup is CORRECT — registered on the right hook, covering
 * every directory the file makes. It checks that the file removes something. A file that creates two
 * and removes one passes. That is the ratchet a regex can carry; the shared helper is what makes the
 * policy itself consistent.
 */
describe("a test that creates a temp dir removes it", () => {
  let scanned: string[] = [];
  let leakers: string[] = [];

  beforeAll(async () => {
    scanned = await walk(TESTS_ROOT);
    leakers = scanned
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return CREATES.test(text) && !CLEANS_UP.test(text);
      })
      .map((f) => relative(TESTS_ROOT, f).split("\\").join("/"));
  });

  it("scans the tests tree — an empty scan would pass the check below", () => {
    expectScopeCovered(scanned, "lint/temp-dirs-are-cleaned-up.test.ts", TESTS_ROOT);
    expect(scanned.length).toBeGreaterThan(700);
  });

  it("no file creates a temp directory and removes nothing", () => {
    expect(
      leakers,
      "this file calls mkdtemp and never removes the result, so every run leaks one directory per " +
        "beforeEach. Register `onTestFinished(() => removeTempDirRobustSync(dir))` — the helper in " +
        "tests/helpers/temp-workspace.ts, whose retry policy is the shared one.",
    ).toEqual([]);
  });
});
