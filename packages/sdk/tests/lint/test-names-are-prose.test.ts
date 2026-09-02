import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { expectScopeCovered } from "./_scope-sentinel.js";

/**
 * `it("test_the_fork_destination_is_born_0600")` reads as "it test the fork destination is born
 * 0600". The prefix restates the function it sits inside, and snake_case restates a sentence.
 *
 * Both forms in this suite describe BEHAVIOUR, which is what `rules/testing.md` § 3 actually asks
 * for, so this is a consistency rule and not a quality one. What makes it worth a gate is the size
 * of the split — measured 2026-09-02, 1327 of 5249 names across 190 of 807 files — and that some
 * files carry both inside one `describe`, so a reader cannot form an expectation from the file they
 * are in.
 *
 * CONTRIBUTING.md § Test names declares the convention and explicitly does NOT demand the rewrite,
 * exactly as its AAA section does. This budget is what stops the minority form from growing, and it
 * asks to be re-pinned downward whenever a file is renamed for other reasons.
 *
 * WHAT THIS DOES NOT CHECK: whether a prose name is a GOOD one. `it("works")` is prose and useless;
 * the gate would not notice. It refuses one form, it does not confer quality on the other.
 */
const TESTS_ROOT = join(import.meta.dirname, "..");

/** Local, like every sibling gate in this directory — a fifth caller would earn a shared module. */
async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const { readdir, stat } = await import("node:fs/promises");
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Re-pin downward whenever this drops. A cap that never moves is a cap nobody is working against.
 *
 * 1323, not the 1327 CONTRIBUTING.md quotes: that figure counts every `test_` name, this one
 * subtracts the seven defect-id exemptions and adds back four the loose count missed. Pinning the
 * looser figure would have left free regressions under the cap — which is exactly how the first
 * counter-proof of this gate PASSED while adding an offender, and why the number was re-measured
 * with the gate's own regex before being pinned.
 */
const MAX_PREFIXED = 1323;

/** `it("test_...")`, `test("test_...")`, and their `.each` / `.skip` variants. */
const PREFIXED = /\b(?:it|test)(?:\.\w+)*\(\s*[`"']test_/g;

/**
 * A name whose first token after `test_` is a defect id from the issue that produced the test —
 * `test_B1_…`, `test_M2_…`. That id is traceability the prose form has nowhere to put, so those
 * names are exempt rather than counted as debt. Seven of them exist today.
 */
const DEFECT_ID = /\b(?:it|test)(?:\.\w+)*\(\s*[`"']test_(?:[A-Z]{1,2}\d+)_/g;

function countIn(file: string): number {
  const body = readFileSync(file, "utf8");
  const all = body.match(PREFIXED)?.length ?? 0;
  const exempt = body.match(DEFECT_ID)?.length ?? 0;
  return all - exempt;
}

describe("test names are prose, and the snake_case minority does not grow", () => {
  let files: string[] = [];
  let prefixed = 0;
  let worst: string[] = [];

  beforeAll(async () => {
    files = await walk(TESTS_ROOT);
    const perFile = files
      .map((f) => ({ file: relative(TESTS_ROOT, f).split("\\").join("/"), n: countIn(f) }))
      .filter((e) => e.n > 0)
      .sort((a, b) => b.n - a.n);
    prefixed = perFile.reduce((sum, e) => sum + e.n, 0);
    worst = perFile.slice(0, 8).map((e) => `${e.file} (${e.n})`);
  });

  it("reached a file that is known to carry the prefix — an empty scan is not a pass", () => {
    expectScopeCovered(files, "internal/llm/pool-aware-client.test.ts", TESTS_ROOT);
  });

  it(`no more than ${MAX_PREFIXED} names carry the redundant test_ prefix`, () => {
    expect(
      prefixed,
      `${prefixed} test names start with "test_" (defect-id names excluded), against a pinned ` +
        `${MAX_PREFIXED}. New tests take a prose name — see CONTRIBUTING.md § Test names. If the ` +
        "count DROPPED, re-pin this number downward.\n\nHeaviest files:\n" +
        worst.join("\n"),
    ).toBeLessThanOrEqual(MAX_PREFIXED);
  });
});
