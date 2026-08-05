/**
 * SE41 eval suite — SCORER coverage + the per-scorer gate (deterministic).
 *
 * Runs a multi-scorer eval over a canned agent so every deterministic scorer
 * lands in `aggregate.perScorer`, then proves `assertEval`'s `perScorer` floors
 * pass (high scorers) and fail (a deliberately-failing scorer). Zero tokens.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { assertEval, Eval, EvalThresholdError, Scorers } from "../../../src/eval.js";
import type { SDKAgent } from "../../../src/types/agent.js";

/** Always answers with the same structured JSON string. */
const jsonAgent = {
  agentId: "agent-json",
  send: (_input: string) =>
    Promise.resolve({
      wait: () => Promise.resolve({ status: "finished" as const, result: '{"answer":"42"}' }),
    }),
} as unknown as SDKAgent;

describe("eval suite: scorer coverage", () => {
  it("populates perScorer for every deterministic scorer and gates on it", async () => {
    const run = await Eval.create({
      name: "scorers-coverage",
      dataset: [
        { input: "q1", expected: '{"answer":"42"}' },
        { input: "q2", expected: '{"answer":"42"}' },
      ],
      scorers: [
        Scorers.exactMatch(),
        Scorers.containsExpected(),
        Scorers.regex(/answer/),
        Scorers.jsonShape(z.object({ answer: z.string() })),
        Scorers.levenshtein({ threshold: 0.9 }),
        Scorers.regex(/zzz/), // deliberately fails → mean 0
      ],
      agent: jsonAgent,
      concurrency: 1,
    }).run();

    // Every scorer produced an aggregate entry.
    for (const name of [
      "exact-match",
      "contains-expected",
      "regex(answer)",
      "json-shape",
      "levenshtein(>=0.9)",
      "regex(zzz)",
    ]) {
      expect(run.aggregate.perScorer[name]).toBeDefined();
    }

    // The passing scorers clear their floors.
    expect(() =>
      assertEval(run, {
        perScorer: {
          "exact-match": 1,
          "contains-expected": 1,
          "json-shape": 1,
          "levenshtein(>=0.9)": 1,
        },
      }),
    ).not.toThrow();

    // The failing scorer trips its floor.
    expect(() => assertEval(run, { perScorer: { "regex(zzz)": 0.5 } })).toThrow(EvalThresholdError);
  });
});
