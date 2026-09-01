/**
 * SE41 — `assertEval(run, thresholds)`: the CI gate for evals.
 *
 * A pure function over a completed {@link EvalRun}. It reads only
 * `run.aggregate`, collects EVERY unmet threshold (not just the first), and
 * throws {@link EvalThresholdError} carrying the full failure list. Passing
 * silently returns `void` — drop it straight into a Vitest `it(...)` or a
 * standalone eval script whose non-zero exit fails the CI job.
 *
 * @public
 */

import { TheokitAgentError } from "../../errors.js";
import type { EvalRun, EvalThresholdFailure, EvalThresholds } from "../../types/eval.js";

/** Thrown by {@link assertEval} when a run misses one or more thresholds. */
export class EvalThresholdError extends TheokitAgentError {
  override readonly name = "EvalThresholdError";
  /** The eval's name (`EvalRun.name`). */
  readonly evalName: string;
  /** Every unmet threshold, in check order. */
  readonly failures: readonly EvalThresholdFailure[];

  constructor(evalName: string, failures: readonly EvalThresholdFailure[]) {
    const lines = failures.map(
      (f) =>
        `  - ${f.metric}: required ${f.threshold}, got ${
          Number.isNaN(f.actual) ? "n/a (scorer absent)" : f.actual
        }`,
    );
    // Not retryable: the scores are already computed; re-running the assertion re-reads the same
    // numbers. Re-running the EVAL is a different act, and the caller decides that.
    super(
      `Eval "${evalName}" failed ${failures.length} threshold${failures.length === 1 ? "" : "s"}:\n${lines.join("\n")}`,
      { code: "eval_threshold_failed", isRetryable: false },
    );
    this.evalName = evalName;
    this.failures = failures;
  }
}

/** `actual < threshold` ⇒ a failure for a floor metric, else `undefined`. */
function floor(
  metric: string,
  actual: number,
  threshold: number | undefined,
): EvalThresholdFailure | undefined {
  if (threshold === undefined || actual >= threshold) return undefined;
  return { metric, threshold, actual };
}

/** Per-scorer floor checks (an absent named scorer is a failure with NaN actual). */
function perScorerFailures(
  perScorer: EvalRun["aggregate"]["perScorer"],
  thresholds: Readonly<Record<string, number>> | undefined,
): EvalThresholdFailure[] {
  if (thresholds === undefined) return [];
  const out: EvalThresholdFailure[] = [];
  for (const [name, min] of Object.entries(thresholds)) {
    const stats = perScorer[name];
    if (stats === undefined || stats.mean < min) {
      out.push({
        metric: `perScorer.${name}`,
        threshold: min,
        actual: stats === undefined ? Number.NaN : stats.mean,
      });
    }
  }
  return out;
}

/**
 * Assert a run meets every set threshold. Throws {@link EvalThresholdError}
 * with the complete list of failures when it does not; returns `void` on pass.
 */
export function assertEval(run: EvalRun, thresholds: EvalThresholds): void {
  const a = run.aggregate;
  const errorRatio = a.totalRows > 0 ? a.errorRows / a.totalRows : 0;
  const ceiling =
    thresholds.maxErrorRatio !== undefined && errorRatio > thresholds.maxErrorRatio
      ? { metric: "errorRatio", threshold: thresholds.maxErrorRatio, actual: errorRatio }
      : undefined;

  const failures = [
    floor("meanScore", a.meanScore, thresholds.minMeanScore),
    floor("passRatio", a.passRatio, thresholds.minPassRatio),
    ceiling,
    ...perScorerFailures(a.perScorer, thresholds.perScorer),
  ].filter((f): f is EvalThresholdFailure => f !== undefined);

  if (failures.length > 0) {
    throw new EvalThresholdError(run.name, failures);
  }
}
