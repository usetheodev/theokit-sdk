/**
 * Public types for the judge subsystem (T2.1, ADR D120).
 *
 * @internal
 */

/**
 * Os verdicts terminais que um judge pode devolver.
 *
 * M80 — `"blocked"` entrou aqui. `GoalResult.status` já o carregava
 * (`types/goal-events.ts:60`), mas o judge não tinha como EMITI-LO: seu vocabulário era
 * `done | continue | skipped`, então diante de um bloqueio real ele só podia dizer `continue` — e o
 * loop repetia o mesmo turno até estourar o orçamento, reportando `failed` por limite em vez de
 * `blocked` por impossibilidade. Duas causas diferentes com o mesmo desfecho visível.
 */
export type Verdict = "done" | "continue" | "skipped" | "blocked";

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
