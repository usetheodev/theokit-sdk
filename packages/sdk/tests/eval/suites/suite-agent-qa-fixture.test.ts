/**
 * SE41 eval suite — agent QA via FIXTURE MODE (deterministic, always runs).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises `Agent.batch` → run → scorer → `assertEval` end to end
 * with zero token spend. `"Return only: X"` makes the agent echo `X`.
 */

import { describe, expect, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";

const FIXTURE_AGENT = {
  apiKey: "theo_test_eval",
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
} as const;

describe("eval suite: agent QA (fixture mode)", () => {
  it("instruction-following: 'Return only: X' echoes X and clears the gate", async () => {
    const run = await Eval.create({
      name: "fixture-return-only",
      dataset: [
        { input: "Return only: Paris", expected: "Paris" },
        { input: "Return only: 42", expected: "42" },
        { input: "Return only: cold", expected: "cold" },
      ],
      scorers: [Scorers.exactMatch(), Scorers.levenshtein({ threshold: 0.9 })],
      agent: FIXTURE_AGENT,
      concurrency: 2,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
    expect(run.aggregate.totalRows).toBe(3);
  });
});
