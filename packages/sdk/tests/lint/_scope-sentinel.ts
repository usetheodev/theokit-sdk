/**
 * The assertion that stops a lint gate from passing by scanning nothing.
 *
 * Every gate in this directory has the shape `walk a tree → collect offenders →
 * expect(offenders).toEqual([])`, and that shape passes identically whether the walk saw 951 files
 * or zero. The failure is not hypothetical here: `validate:naming` once exited 0 having checked 18
 * of 951 files, and the `tests/architecture/` cycle checks carry a comment recording the period
 * during which they "passed vacuously" because a path had one `..` too many. Nobody looked, because
 * there was nothing to look at — a green gate reads as coverage.
 *
 * WHY A SENTINEL AND NOT A COUNT. The obvious guard, `expect(files.length).toBeGreaterThan(N)`, is
 * the design that produced a sibling finding in this same directory: a gate asserting
 * `toBeLessThanOrEqual(60)` over a real count of 28, leaving 32 free regressions nobody would ever
 * notice. A number chosen today drifts, and the person it drifts past is not the person who chose
 * it. A sentinel path cannot drift: either the scan reached the file or the scope is broken.
 *
 * WHAT THIS DOES NOT DO, stated rather than implied. It proves the walk REACHED the file. It does
 * not prove the detector would have recognised an offender inside it — that is the stronger guard,
 * a detector self-test that plants a known offender in a temp tree, and `no-ptbr.test.ts` is the one
 * gate here that has one. This is the weaker tier, applied where the gate's detector is inlined in
 * its test body and cannot be called on a fixture without restructuring the gate.
 */
import { relative } from "node:path";

import { expect } from "vitest";

/**
 * Asserts the scanned set reached `sentinel`.
 *
 * @param scanned - Absolute paths the gate's walk produced.
 * @param sentinel - A repo-relative path that must be inside the gate's scope. Pick a file that
 *   exists for a structural reason (a package entry point, the gate's own file), never one that
 *   happens to be there today.
 * @param root - The absolute root the walk started from, used to render readable failures.
 */
export function expectScopeCovered(
  scanned: readonly string[],
  sentinel: string,
  root: string,
): void {
  const relatives = scanned.map((f) => relative(root, f).split("\\").join("/"));
  expect(
    relatives,
    `This gate's scan never reached ${sentinel}, so "no offenders" means "nothing was read". ` +
      `It walked ${relatives.length} file(s) under ${root}. Fix the scope, do not delete this check.`,
  ).toContain(sentinel);
}
