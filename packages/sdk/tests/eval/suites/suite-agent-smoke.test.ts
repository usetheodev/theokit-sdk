/**
 * SE41 eval suite — DETERMINISTIC gate (always runs in CI, zero token spend).
 *
 * Evaluates a canned agent so the eval GATE itself (`Eval.run` → `assertEval`)
 * is exercised on every `pnpm test` / `pnpm eval` run without an LLM. The
 * negative test proves the gate actually fails a regression (an eval that can
 * never go red is worthless).
 */

import { describe, expect, it } from "vitest";

import { assertEval, Eval, EvalThresholdError, Scorers } from "../../../src/eval.js";
import type { SDKAgent } from "../../../src/types/agent.js";

/** A deterministic stand-in agent: canned answers keyed by prompt. */
function cannedAgent(answers: Record<string, string>): SDKAgent {
  return {
    agentId: "agent-canned",
    send: (input: string) =>
      Promise.resolve({
        wait: () => Promise.resolve({ status: "finished" as const, result: answers[input] ?? "" }),
      }),
  } as unknown as SDKAgent;
}

const dataset = [
  { input: "capital of france", expected: "Paris" },
  { input: "2+2", expected: "4" },
  { input: "opposite of hot", expected: "cold" },
];

describe("eval suite: agent smoke (deterministic)", () => {
  it("clears the gate when every answer matches", async () => {
    const run = await Eval.create({
      name: "suite-smoke-pass",
      dataset,
      scorers: [Scorers.containsExpected(), Scorers.levenshtein({ threshold: 0.8 })],
      agent: cannedAgent({ "capital of france": "Paris", "2+2": "4", "opposite of hot": "cold" }),
      concurrency: 2,
    }).run();

    expect(() =>
      assertEval(run, { minMeanScore: 0.9, minPassRatio: 1, maxErrorRatio: 0 }),
    ).not.toThrow();
  });

  it("fails the gate (throws EvalThresholdError) on a regression", async () => {
    const run = await Eval.create({
      name: "suite-smoke-fail",
      dataset,
      scorers: [Scorers.containsExpected()],
      agent: cannedAgent({ "capital of france": "London", "2+2": "5", "opposite of hot": "cold" }),
      concurrency: 2,
    }).run();

    expect(() => assertEval(run, { minPassRatio: 0.9 })).toThrow(EvalThresholdError);
  });
});
