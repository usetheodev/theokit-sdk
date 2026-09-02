/**
 * A loose test file must not announce a directory that exists.
 *
 * `tests/README.md § Where a new test file goes` states the rule; this is what keeps it true. The
 * rule was written after measuring the tree: 52 of 251 loose files named a sibling directory that
 * already existed and held a MINORITY of the relevant tests — `tests/memory-*.test.ts` x15 against
 * two files in `tests/memory/`, `tests/agent-loop-*` x12 against four. A contributor who opened the
 * obvious directory found the smaller half and had no way to learn about the larger one.
 *
 * The rule is deliberately narrow. It does NOT say every test belongs in a subdirectory — a test
 * exercising a published `exports` subpath belongs at the root, where it mirrors the public surface,
 * and 203 files legitimately sit there. It says only: if `tests/<x>/` exists, `tests/<x>-*.test.ts`
 * is a file in the wrong place, by its own name.
 *
 * A rule stated in a README and enforced by nobody is how the tree got into that state to begin
 * with, which is why this file exists next to the README rather than instead of it.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const TESTS_ROOT = join(__dirname, "..");

const entries = readdirSync(TESTS_ROOT);
const directories = entries.filter((e) => statSync(join(TESTS_ROOT, e)).isDirectory());
const looseTests = entries.filter((e) => e.endsWith(".test.ts"));

describe("test file placement", () => {
  it("scans a tree that actually has both loose files and topic directories", () => {
    // Anti-vacuity. Every assertion below is over a filtered list, and a filter over an empty list
    // passes while proving nothing. If `tests/` is ever restructured such that these are empty, the
    // check silently stops checking — this is the case that says so out loud.
    expect(directories.length).toBeGreaterThan(5);
    expect(looseTests.length).toBeGreaterThan(0);
  });

  it("no loose test file names a directory that already exists", () => {
    const misplaced = looseTests
      .map((file) => {
        const dir = directories.find((d) => file.startsWith(`${d}-`));
        return dir === undefined
          ? undefined
          : { file, belongsIn: `tests/${dir}/${file.slice(dir.length + 1)}` };
      })
      .filter((x): x is { file: string; belongsIn: string } => x !== undefined);

    expect(
      misplaced,
      misplaced.length === 0
        ? ""
        : `These files name a directory that exists, so a contributor opening that directory does ` +
            `not find them:\n${misplaced.map((m) => `  tests/${m.file}  ->  ${m.belongsIn}`).join("\n")}\n` +
            `Move them, or see tests/README.md if the placement is deliberate.`,
    ).toEqual([]);
  });
});
