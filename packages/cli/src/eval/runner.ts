/**
 * Eval runner — D212 swap: now consumes `Eval.create + .run` from the SDK
 * (Adoption Roadmap #2). The public `EvalConfig` shape is unchanged —
 * D199 made this a forward-compatible move.
 *
 * Why preserve the CLI's `EvalRunResult` shape: the markdown report
 * generator + existing tests depend on it. The SDK's `EvalRun` is a
 * superset; we adapt at the boundary.
 *
 * @internal
 */

import { randomUUID } from "node:crypto";
import { Eval, type EvalRun, type Scorer as SdkScorer } from "@theokit/sdk/eval";

import type { EvalConfig, EvalRowResult, EvalRunResult } from "./types.js";

/**
 * Run the suite through the SDK's `Eval.create().run()` and narrow the result to the CLI's shape.
 *
 * An empty `dataset` short-circuits: no agent is constructed, no provider is contacted, and a
 * zero-row result comes back with every aggregate at 0 (`meanScore: 0` there means "nothing ran",
 * not "everything scored 0").
 *
 * Each run gets a fresh `theokit-eval-<8 hex>` name for telemetry correlation (D213), so two runs of
 * the same config are never conflated. The SDK's richer per-run fields (latency percentiles, token
 * counts) are dropped here — the markdown report consumes the simple shape.
 *
 * Rejects if the underlying run rejects; `theokit eval` turns that into exit 1.
 */
export async function runEvalSuite(config: EvalConfig): Promise<EvalRunResult> {
  if (config.dataset.length === 0) {
    return {
      rows: [],
      aggregate: { meanScore: 0, passRatio: 0, totalRows: 0, errorRows: 0 },
    };
  }

  // Translate CLI's EvalConfig → SDK's EvalOptions. Scorers map 1:1 because
  // both surfaces use the same `Scorer` type per D207.
  const sdkScorers = config.scorers.map((s) => ({
    name: s.name,
    score: s.score as SdkScorer,
  }));

  const run: EvalRun = await Eval.create({
    // Unique per-process name for telemetry correlation (D213). Use UUID
    // so concurrent CLI invocations on different terminals don't collide.
    name: `theokit-eval-${randomUUID().slice(0, 8)}`,
    dataset: config.dataset,
    scorers: sdkScorers,
    agent: config.agent,
    ...(config.concurrency !== undefined ? { concurrency: config.concurrency } : {}),
  }).run();

  // Adapt SDK's EvalRun to the CLI's existing EvalRunResult shape. The CLI
  // shape is simpler (no p50/p95/tokens — those live in SDK aggregate);
  // the markdown report consumes the simple shape.
  const rows: EvalRowResult[] = run.rows.map((r) => ({
    input: r.input,
    output: r.output,
    ...(r.expected !== undefined ? { expected: r.expected } : {}),
    scores: r.scores.map((s) => ({
      name: s.name,
      score: s.score,
      ...(s.reason !== undefined ? { reason: s.reason } : {}),
    })),
    meanScore: r.meanScore,
    ...(r.error !== undefined ? { error: r.error } : {}),
  }));

  return {
    rows,
    aggregate: {
      meanScore: run.aggregate.meanScore,
      passRatio: run.aggregate.passRatio,
      totalRows: run.aggregate.totalRows,
      errorRows: run.aggregate.errorRows,
    },
  };
}
