/**
 * SE41 — trial expansion + collapse for `EvalOptions.trials`.
 *
 * Strategy: EXPAND each dataset entry into `trials` tagged copies, run them
 * through the existing execution paths untouched, then COLLAPSE the resulting
 * per-trial rows back into one row per original entry. Per-scorer score is the
 * mean over the trials — an errored trial contributes 0 (a reliability signal),
 * so the denominator is always `trials`, not the count of successful trials.
 *
 * @internal
 */

import type { DatasetEntry, EvalRowResult } from "../../types/eval.js";

/** Reserved metadata key: the original dataset-row index a trial belongs to. */
export const TRIAL_INDEX_KEY = "__evalRowIndex";
/** Reserved metadata key: the 0-based trial number within a row. */
export const TRIAL_NUM_KEY = "__evalTrial";

/** Repeat each entry `trials` times, tagging each copy with its origin + trial number. */
export function expandForTrials(
  entries: ReadonlyArray<DatasetEntry>,
  trials: number,
): DatasetEntry[] {
  const out: DatasetEntry[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === undefined) continue;
    for (let t = 0; t < trials; t += 1) {
      out.push({
        ...entry,
        metadata: { ...(entry.metadata ?? {}), [TRIAL_INDEX_KEY]: i, [TRIAL_NUM_KEY]: t },
      });
    }
  }
  return out;
}

function stripReserved(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (metadata === undefined) return undefined;
  const { [TRIAL_INDEX_KEY]: _idx, [TRIAL_NUM_KEY]: _trial, ...rest } = metadata;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function sumDefined(values: ReadonlyArray<number | undefined>): number | undefined {
  const present = values.filter((v): v is number => typeof v === "number");
  return present.length > 0 ? present.reduce((acc, v) => acc + v, 0) : undefined;
}

/** Mean score per scorer across the group, denominator `trials` (errored → 0). */
function meanScoresByScorer(
  group: EvalRowResult[],
  trials: number,
): Array<{ name: string; score: number; reason: string }> {
  const names: string[] = [];
  const sums = new Map<string, number>();
  for (const row of group) {
    for (const s of row.scores) {
      if (!sums.has(s.name)) {
        names.push(s.name);
        sums.set(s.name, 0);
      }
      sums.set(s.name, (sums.get(s.name) ?? 0) + s.score);
    }
  }
  return names.map((name) => ({
    name,
    score: (sums.get(name) ?? 0) / trials,
    reason: `mean of ${trials} trials`,
  }));
}

function collapseGroup(index: number, group: EvalRowResult[], trials: number): EvalRowResult {
  const first = group[0] as EvalRowResult;
  const scores = meanScoresByScorer(group, trials);
  const allErrored = group.every((r) => r.error !== undefined);
  const meanScore =
    allErrored || scores.length === 0
      ? 0
      : scores.reduce((acc, s) => acc + s.score, 0) / scores.length;
  const firstOk = group.find((r) => r.error === undefined);
  const errorMsg = allErrored ? group.find((r) => r.error !== undefined)?.error : undefined;
  const metadata = stripReserved(first.metadata);
  const tokensIn = sumDefined(group.map((r) => r.tokensIn));
  const tokensOut = sumDefined(group.map((r) => r.tokensOut));

  return {
    index,
    input: first.input,
    output: firstOk?.output ?? first.output,
    ...(first.expected !== undefined ? { expected: first.expected } : {}),
    scores,
    meanScore,
    durationMs: group.reduce((acc, r) => acc + r.durationMs, 0),
    ...(tokensIn !== undefined ? { tokensIn } : {}),
    ...(tokensOut !== undefined ? { tokensOut } : {}),
    ...(errorMsg !== undefined ? { error: errorMsg } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    trialCount: trials,
  };
}

/** Group per-trial rows by their original entry index and collapse each group. */
export function collapseTrials(
  rows: ReadonlyArray<EvalRowResult>,
  trials: number,
): EvalRowResult[] {
  const groups = new Map<number, EvalRowResult[]>();
  for (const row of rows) {
    const meta = row.metadata as Record<string, unknown> | undefined;
    const origIdx =
      typeof meta?.[TRIAL_INDEX_KEY] === "number" ? (meta[TRIAL_INDEX_KEY] as number) : row.index;
    const arr = groups.get(origIdx) ?? [];
    arr.push(row);
    groups.set(origIdx, arr);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([origIdx, group]) => collapseGroup(origIdx, group, trials));
}
