/**
 * Eval runner — wraps `Agent.batch` (D134) per ADR D199 (T5.1).
 *
 * EC-K (edge-case review): scorers may be sync OR async. The runner
 * always `await`s the return so both shapes work transparently.
 *
 * @internal
 */

import { Agent } from "@usetheo/sdk";

import type { EvalConfig, EvalRowResult, EvalRunResult, Score, Scorer } from "./types.js";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: dataset iteration + scorer application + aggregation is one cohesive flow; splitting hurts readability.
export async function runEvalSuite(config: EvalConfig): Promise<EvalRunResult> {
  if (config.dataset.length === 0) {
    return {
      rows: [],
      aggregate: { meanScore: 0, passRatio: 0, totalRows: 0, errorRows: 0 },
    };
  }

  const prompts = config.dataset.map((d) => d.input);

  // Agent.batch reuses D134-D140 — concurrency, failure isolation,
  // credential pool sharing. Returns BatchResult[] directly per D138.
  const batchResults = await Agent.batch(prompts, {
    ...config.agent,
    concurrency: config.concurrency ?? 4,
  });

  const rows: EvalRowResult[] = [];
  let totalScore = 0;
  let passCount = 0;
  let errorCount = 0;

  for (let i = 0; i < config.dataset.length; i += 1) {
    const entry = config.dataset[i];
    const item = batchResults[i];
    if (entry === undefined) continue;
    const expected = entry.expected;

    if (item === undefined || item.ok !== true) {
      errorCount += 1;
      rows.push({
        input: entry.input,
        output: "",
        ...(expected !== undefined ? { expected } : {}),
        scores: [],
        meanScore: 0,
        error: item !== undefined && item.ok === false ? item.error.message : "agent_run_error",
      });
      continue;
    }

    const output = item.result.result ?? "";
    const scoreEntries: EvalRowResult["scores"] = [];
    for (const scorer of config.scorers) {
      const score = await applyScorer(scorer.score, output, expected);
      scoreEntries.push({
        name: scorer.name,
        score: score.score,
        ...(score.reason !== undefined ? { reason: score.reason } : {}),
      });
    }
    const meanScore =
      scoreEntries.length > 0
        ? scoreEntries.reduce((acc, s) => acc + s.score, 0) / scoreEntries.length
        : 0;
    if (meanScore >= 0.5) passCount += 1;
    totalScore += meanScore;
    rows.push({
      input: entry.input,
      output,
      ...(expected !== undefined ? { expected } : {}),
      scores: scoreEntries,
      meanScore,
    });
  }

  return {
    rows,
    aggregate: {
      meanScore: rows.length > 0 ? totalScore / rows.length : 0,
      passRatio: rows.length > 0 ? passCount / rows.length : 0,
      totalRows: rows.length,
      errorRows: errorCount,
    },
  };
}

async function applyScorer(scorer: Scorer, output: string, expected?: unknown): Promise<Score> {
  try {
    const result = await scorer(output, expected);
    if (typeof result.score !== "number" || Number.isNaN(result.score)) {
      return { score: 0, reason: "scorer_returned_invalid_score" };
    }
    return result;
  } catch (err) {
    return {
      score: 0,
      reason: `scorer_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
