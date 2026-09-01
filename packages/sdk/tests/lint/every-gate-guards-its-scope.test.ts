/**
 * Every lint gate must prove it read something. This is the gate on the gates.
 *
 * Twelve of the sixteen files in this directory once had the shape "walk a tree, collect offenders,
 * expect(offenders).toEqual([])", which passes identically whether the walk saw 951 files or zero.
 * They were fixed one by one. Fixing twelve files does not stop the thirteenth from being written
 * the same way — this does, and it is the reason this file exists rather than a note in a README.
 *
 * A gate satisfies the rule by carrying ONE of:
 *   - `expectScopeCovered(...)` — the sentinel: the scan reached a file that must be in scope.
 *   - a detector self-test — plants a known offender in a temp tree and asserts the scanner finds
 *     exactly it. Strictly stronger, because it proves the DETECTOR works and not merely that files
 *     were read. `no-ptbr.test.ts` has one.
 *   - a structural coverage assertion of its own — `toBeGreaterThan` over the scanned set, or a
 *     `toContain` naming a file the scope must reach.
 *
 * The count form is the WEAKEST of the three and is accepted rather than endorsed. A hand-picked
 * floor drifts: a sibling gate in this directory asserts `toBeLessThanOrEqual(60)` over a real count
 * of 28, leaving 32 free regressions. Prefer the sentinel, which cannot drift, and prefer the
 * detector self-test over both.
 *
 * The allowlist below is not an escape hatch: each entry names the stronger guard the file already
 * has. An entry with no such guard is a bug in this file, not an exemption.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const LINT_DIR = __dirname;

/** Files whose guard is stronger than the sentinel, with the guard named. */
const STRONGER_GUARD: ReadonlyMap<string, string> = new Map([
  [
    "no-ptbr.test.ts",
    "detector self-test: builds a synthetic repo under mkdtemp, plants a known offender, and asserts " +
      "the scanner returns exactly one hit with the right tier and word",
  ],
  [
    "ls-lint-covers-every-extension.test.ts",
    "the gate's subject IS the scope — it asserts the configured scope contains every extension " +
      "present in the tree, so a narrowing scope is the failure it reports",
  ],
  [
    "every-gate-guards-its-scope.test.ts",
    "this file — its own anti-vacuity case is the first `it` below",
  ],
]);

/**
 * The shapes that count as proof the scan read something. Ordered strongest first; see the file
 * docblock for why the last one is accepted rather than recommended.
 */
const GUARD_FORMS: readonly RegExp[] = [
  /expectScopeCovered\s*\(/,
  /expect\([^)]*\)[\s\S]{0,120}?\.toContain\(/,
  /expect\([^)]*\.length[\s\S]{0,120}?\.toBeGreaterThan(?:OrEqual)?\(/,
];

const gates = readdirSync(LINT_DIR).filter((f) => f.endsWith(".test.ts"));

describe("every lint gate guards its own scope", () => {
  it("finds gates to check at all", () => {
    // The rule this file enforces, applied to this file. A directory listing that returns nothing
    // would make every assertion below vacuous — which is the exact defect being policed.
    expect(gates.length).toBeGreaterThan(10);
    expect(gates).toContain("no-ptbr.test.ts");
  });

  it("no gate can report a pass while having read nothing", () => {
    const unguarded = gates.filter((file) => {
      if (STRONGER_GUARD.has(file)) return false;
      const text = readFileSync(join(LINT_DIR, file), "utf8");
      return !GUARD_FORMS.some((form) => form.test(text));
    });

    expect(
      unguarded,
      unguarded.length === 0
        ? ""
        : `These gates walk a tree and assert the result is empty, with nothing proving the walk ` +
            `reached any file — so a broken path or an over-narrow filter reads as a pass:\n` +
            `${unguarded.map((f) => `  tests/lint/${f}`).join("\n")}\n` +
            `Add expectScopeCovered(scanned, "<a file that must be in scope>", ROOT) from ` +
            `./_scope-sentinel.js, or a detector self-test and an entry in STRONGER_GUARD naming it.`,
    ).toEqual([]);
  });

  it("every allowlisted file still exists", () => {
    // An allowlist entry for a deleted file is an exemption nobody can check. It also silently
    // widens the allowlist's meaning as files are renamed around it.
    const missing = [...STRONGER_GUARD.keys()].filter((f) => !gates.includes(f));
    expect(
      missing,
      `STRONGER_GUARD names files that are not in tests/lint/: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
