/**
 * Public types for the judge subsystem (T2.1, ADR D120).
 *
 * @internal
 */

/** The three terminal verdicts a judge model may return. ADR D120. */
export type Verdict = "done" | "continue" | "skipped";

/** Outcome of {@link parseVerdict} / {@link judgeCallImpl}. */
export interface JudgeResult {
  verdict: Verdict;
  reason: string;
  /**
   * `true` when the underlying text did not start with one of the three
   * canonical prefixes. The verdict is set to `"continue"` (fail-safe,
   * ADR D121) to avoid stopping prematurely; callers track consecutive
   * failures and bail via `maxConsecutiveJudgeFailures`.
   */
  parseFailed: boolean;
}
