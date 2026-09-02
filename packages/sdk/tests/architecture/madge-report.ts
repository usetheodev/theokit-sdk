/**
 * One `madge --circular` report, shared by every architecture cycle test.
 *
 * WHY THIS FILE EXISTS — two defects, both measured 2026-09-01.
 *
 * 1. ELEVEN SPAWNS OF THE SAME GRAPH. `runMadge()` was copy-pasted into four
 *    test files and called once per `it()`: 5 + 1 + 2 + 3 = 11 invocations, each
 *    re-parsing all 538 files of `packages/sdk/src`. Measured across one
 *    `pnpm validate`: 73.5s + 14.7s + 7.2s + 3.9s = 99.4s, against 1.9s for a
 *    single madge run on an idle machine. The gap is `pnpm exec` startup plus
 *    contention — vitest's forks pool runs the four files as parallel
 *    subprocesses, so the eleven spawns compete with each other and with the
 *    rest of the suite. Two tests timed out at the 20s per-test budget as a
 *    direct result. Memoising at module scope cuts it to one spawn per file.
 *
 * 2. A FAILED MADGE PASSED EVERY TEST. The old helper ended with
 *    `return (result.stdout ?? "") + (result.stderr ?? "")` and read neither
 *    `result.status` nor `result.error`. When madge does not run, that returns
 *    `""`; callers then filter an empty line list for offending cycles, find
 *    none, and assert success. The failure mode is not hypothetical — the
 *    comments those helpers carried record it happening once already, when the
 *    repo-root walk was one level too high and `pnpm exec` answered
 *    ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE. The tests went green over a tool that
 *    never looked at the code.
 *
 * The guard against (2) is {@link assertMadgeRan}, kept as a pure function so
 * `madge-report.test.ts` can prove it rejects each failure shape without
 * needing to break the real toolchain.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/** Shape of the `spawnSync` result this module consumes. */
export interface MadgeSpawnResult {
  error?: Error | undefined;
  status: number | null;
  stdout: string | null;
  stderr: string | null;
}

/**
 * Madge prints this line whenever it has walked the tree, both when it finds
 * cycles and when it finds none. Its ABSENCE is what distinguishes "madge ran
 * and reported nothing" from "madge never ran" — the two states the old helper
 * collapsed into the same empty string.
 */
const PROCESSED_SENTINEL = /Processed \d+ files/;

/**
 * Validate that madge actually executed, and return its combined output.
 *
 * Throws — never returns a degraded value — because every caller treats the
 * returned text as evidence about the dependency graph. A caller cannot tell an
 * empty report from an absent one, so this is the only place the distinction
 * can be enforced.
 */
export function assertMadgeRan(result: MadgeSpawnResult): string {
  if (result.error !== undefined) {
    throw new Error(`madge could not be spawned: ${result.error.message}`);
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(
      `madge exited with status ${String(result.status)} instead of 0. Output:\n${output}`,
    );
  }
  if (!PROCESSED_SENTINEL.test(output)) {
    throw new Error(
      "madge exited 0 but its output carries no 'Processed N files' line, so it " +
        "never walked the tree. Treating this as a failure rather than as an empty " +
        `report is the whole point of this check. Output:\n${output}`,
    );
  }
  return output;
}

let cached: string | undefined;

/**
 * The `madge --circular` report for `packages/sdk/src`, computed once per
 * process (vitest's forks pool gives each test file its own).
 */
export function madgeCircularReport(): string {
  if (cached !== undefined) return cached;
  // Four levels up from `packages/sdk/tests/architecture` is the `theokit-sdk`
  // workspace root. FIVE lands in the meta-repo, which has no pnpm workspace —
  // that is the exact mistake that produced defect (2) above.
  const repoRoot = resolve(__dirname, "../../../..");
  const result = spawnSync(
    "pnpm",
    ["exec", "madge", "--circular", "--extensions", "ts,tsx", "packages/sdk/src"],
    { cwd: repoRoot, encoding: "utf8", timeout: 60_000 },
  );
  cached = assertMadgeRan(result);
  return cached;
}

/** The numbered cycle lines of a madge report (`1) a.ts > b.ts`). */
export function cycleLines(output: string): string[] {
  return output.split("\n").filter((line) => /^\d+\)/.test(line.trim()));
}
