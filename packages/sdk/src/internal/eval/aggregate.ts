/**
 * D211 — compute `EvalAggregate` from a list of `EvalRowResult`.
 *
 * Pure functions; no IO. p50/p95 computed via sort+index (O(n log n) is
 * fine for v1; eval datasets are bounded by D210 streaming-deferral).
 *
 * @internal
 */

import type { EvalAggregate, EvalRowResult, PerScorerStats } from "../../types/eval.js";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  // Nearest-rank method: idx = ceil(p/100 * N) - 1
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

export function computeAggregate(rows: ReadonlyArray<EvalRowResult>): EvalAggregate {
  if (rows.length === 0) {
    return {
      meanScore: 0,
      medianScore: 0,
      passRatio: 0,
      perScorer: {},
      totalRows: 0,
      errorRows: 0,
      durationMsP50: 0,
      durationMsP95: 0,
      tokensInTotal: 0,
      tokensOutTotal: 0,
    };
  }

  const meanScores = rows.map((r) => r.meanScore);
  const sortedMeans = [...meanScores].sort((a, b) => a - b);
  const meanScore = meanScores.reduce((acc, s) => acc + s, 0) / rows.length;
  const medianScore = median(sortedMeans);
  const passRatio = rows.filter((r) => r.meanScore >= 0.5).length / rows.length;
  const errorRows = rows.filter((r) => r.error !== undefined).length;

  // Per-scorer rollup: gather all scores by scorer name across all rows.
  const perScorerBuckets = new Map<string, number[]>();
  for (const row of rows) {
    for (const s of row.scores) {
      const bucket = perScorerBuckets.get(s.name) ?? [];
      bucket.push(s.score);
      perScorerBuckets.set(s.name, bucket);
    }
  }
  const perScorer: Record<string, PerScorerStats> = {};
  for (const [name, scores] of perScorerBuckets) {
    const sorted = [...scores].sort((a, b) => a - b);
    perScorer[name] = {
      mean: scores.reduce((acc, s) => acc + s, 0) / scores.length,
      median: median(sorted),
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
    };
  }

  const durations = [...rows.map((r) => r.durationMs)].sort((a, b) => a - b);
  const durationMsP50 = percentile(durations, 50);
  const durationMsP95 = percentile(durations, 95);

  const tokensInTotal = rows.reduce((acc, r) => acc + (r.tokensIn ?? 0), 0);
  const tokensOutTotal = rows.reduce((acc, r) => acc + (r.tokensOut ?? 0), 0);

  return {
    meanScore,
    medianScore,
    passRatio,
    perScorer,
    totalRows: rows.length,
    errorRows,
    durationMsP50,
    durationMsP95,
    tokensInTotal,
    tokensOutTotal,
  };
}

/**
 * Clamp a raw scorer return to a safe [0, 1] number. Rejects NaN, ±Infinity,
 * negatives, > 1 (EC-6). Returns a sanitized `{score, reason}` pair.
 *
 * @internal
 */
export function clampScore(raw: { score: number; reason?: string }): {
  score: number;
  reason?: string;
} {
  let score = raw.score;
  let reason = raw.reason;
  if (!Number.isFinite(score)) {
    score = 0;
    reason = reason ?? "score_not_finite";
  } else if (score < 0) {
    score = 0;
    reason = reason ?? "score_below_zero";
  } else if (score > 1) {
    score = 1;
    reason = reason ?? "score_above_one";
  }
  return reason === undefined ? { score } : { score, reason };
}
