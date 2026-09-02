/**
 * `.toThrow()` with no argument passes on ANY failure — including a TypeError from the test's own
 * setup, which two files in this suite call out by name (`internal/llm/responses.test.ts:138`, "ironic
 * given the test's own name", and `squad-agent-definition.test.ts:80`). It is a green that says
 * "something went wrong", which is the one thing a test asserting an error already knows.
 *
 * B-079 replaced these across the suite and left ~30 comments recording the typed error at each site
 * — genuinely good work that stopped 17 sites short, because nothing stopped the next one. This is
 * the ratchet. The campaign's own comments are the proof it was worth having.
 *
 * `.not.toThrow()` is a different assertion and is untouched: it says a call completes, which is a
 * real claim about behaviour.
 *
 * WHAT THIS CANNOT CHECK: whether the matcher someone passes is a good one. `.toThrow(/./)` satisfies
 * it. The rule is that the site names SOMETHING about the failure, which is what makes a wrong guess
 * visible when the test runs — it does not make the guess right.
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { expectScopeCovered } from "./_scope-sentinel.js";

const TESTS_ROOT = join(__dirname, "..");

/** This file, excluded from its own offender scan — see the note in the loop. */
const SELF = join("lint", "no-bare-throw-assertion.test.ts");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const { readdir, stat } = await import("node:fs/promises");
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else if (full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** A line that ASSERTS a throw without naming anything about it. Comments do not count. */
function isBareThrowAssertion(line: string): boolean {
  const code = line.trim();
  if (code.startsWith("//") || code.startsWith("*")) return false;
  return code.includes(".toThrow()") && !code.includes(".not.toThrow()");
}

/** `path:line` for every bare throw assertion in `file`. */
function bareThrowsIn(file: string): string[] {
  const rel = relative(TESTS_ROOT, file);
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line, i) => (isBareThrowAssertion(line) ? `${rel}:${i + 1}` : undefined))
    .filter((hit): hit is string => hit !== undefined);
}

describe("no bare throw assertions", () => {
  let scanned: string[] = [];
  const offenders: string[] = [];

  beforeAll(async () => {
    scanned = await walk(TESTS_ROOT);
    for (const file of scanned) {
      // This file names the forbidden form in its own assertion text and its own matcher check, so it
      // flagged itself on the first run. Excluded from the OFFENDER scan only — it stays in
      // `scanned`, so the coverage sentinel above still proves the walk reached it.
      if (file.endsWith(SELF)) continue;
      offenders.push(...bareThrowsIn(file));
    }
  });

  it("scans the whole tests tree — an empty scan would pass the check below", () => {
    expectScopeCovered(scanned, "lint/no-bare-throw-assertion.test.ts", TESTS_ROOT);
    expect(scanned.length).toBeGreaterThan(700);
  });

  it("every throw assertion names something about the failure", () => {
    expect(
      offenders,
      "`.toThrow()` with no argument passes on any failure, including one the test caused itself. " +
        "Pass the typed error, a message pattern, or use `.rejects.toMatchObject({ code })` — and " +
        "MEASURE which error arrives rather than inferring it: two sites in this suite were typed " +
        "with each other's ZodError shape on the first attempt, and only running them showed it.",
    ).toEqual([]);
  });
});
