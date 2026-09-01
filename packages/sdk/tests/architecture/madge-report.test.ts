/**
 * Regression cover for the anti-vacuity guard in `madge-report.ts`.
 *
 * The defect this protects against is not a crash — it is a SILENT PASS. Four
 * architecture test files asserted "madge reports no cycle X" while reading
 * neither the exit status nor the spawn error, so any run in which madge failed
 * to execute produced an empty report, an empty cycle list, and a full green
 * suite. The tests were green over a tool that never looked at the code.
 *
 * These cases are therefore about the SHAPES OF FAILURE, exercised against the
 * pure validator rather than by breaking the real toolchain: a test that has to
 * sabotage `pnpm` to run is a test nobody keeps.
 */
import { describe, expect, it } from "vitest";
import { assertMadgeRan, cycleLines } from "./madge-report.js";

const OK_NO_CYCLES =
  "- Finding files\nProcessed 538 files (1.4s) \n\n✔ No circular dependency found!\n";
const OK_WITH_CYCLES =
  "Processed 538 files (1.5s)\n\n✖ Found 2 circular dependencies!\n\n1) a.ts > b.ts\n2) c.ts > d.ts\n";

describe("assertMadgeRan", () => {
  it("returns the combined output when madge ran and reported no cycles", () => {
    expect(assertMadgeRan({ status: 0, stdout: OK_NO_CYCLES, stderr: "" })).toBe(OK_NO_CYCLES);
  });

  it("returns the combined output when madge ran and reported cycles", () => {
    // A non-empty cycle list is a successful RUN. Whether the cycles are
    // acceptable is each caller's assertion, never this validator's.
    expect(assertMadgeRan({ status: 0, stdout: OK_WITH_CYCLES, stderr: "" })).toBe(OK_WITH_CYCLES);
  });

  it("throws when the binary could not be spawned at all", () => {
    expect(() =>
      assertMadgeRan({
        error: new Error("spawnSync pnpm ENOENT"),
        status: null,
        stdout: null,
        stderr: null,
      }),
    ).toThrow(/could not be spawned/);
  });

  it("throws on the historical ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE failure", () => {
    // The exact output observed when the repo-root walk is one level too high
    // and `pnpm exec` lands in the meta-repo. Before the guard existed this
    // string reached the callers, who read zero cycle lines out of it and passed.
    expect(() =>
      assertMadgeRan({
        status: 1,
        stdout: "",
        stderr: "[ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE] No package found in this workspace\n",
      }),
    ).toThrow(/exited with status 1/);
  });

  it("throws when madge exits 0 but never walked the tree", () => {
    // The subtle half: a zero exit with no 'Processed N files' line means the
    // report is absent, not empty. Only the sentinel separates the two.
    expect(() => assertMadgeRan({ status: 0, stdout: "", stderr: "" })).toThrow(
      /never walked the tree/,
    );
  });

  it("throws when a zero exit carries plausible output without the sentinel", () => {
    expect(() =>
      assertMadgeRan({ status: 0, stdout: "✔ No circular dependency found!\n", stderr: "" }),
    ).toThrow(/never walked the tree/);
  });
});

describe("cycleLines", () => {
  it("extracts only the numbered cycle lines", () => {
    expect(cycleLines(OK_WITH_CYCLES)).toEqual(["1) a.ts > b.ts", "2) c.ts > d.ts"]);
  });

  it("returns an empty list for a clean report", () => {
    expect(cycleLines(OK_NO_CYCLES)).toEqual([]);
  });
});
