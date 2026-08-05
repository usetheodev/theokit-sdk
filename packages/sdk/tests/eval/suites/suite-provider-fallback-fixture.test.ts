/**
 * Eval suite — provider fallback resilience via FIXTURE MODE (deterministic, always runs).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises `Eval.create` -> `Agent.batch` -> run -> scorer ->
 * `assertEval` end to end against the provider-fallback capability with zero
 * token spend.
 *
 * The prompt "Use provider fallback." dispatches to `providerFallbackScript`
 * (see `internal/runtime/fixtures/fixture-responder.ts`), which finishes with the
 * exact, deterministic assistant result "Falling back to alternate provider."
 * and attaches routing metadata to the run. The run FINISHES (no error row), so
 * the resilience path is graded on both the output text and a zero error rate.
 * Everything else mirrors the QA fixture suite: `theo_test_eval` key,
 * `openai/gpt-4o-mini`, sandbox off.
 */

import { describe, expect, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";

const FIXTURE_AGENT = {
  apiKey: "theo_test_eval",
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
} as const;

describe("eval suite: provider fallback resilience (fixture mode)", () => {
  it("falls back and finishes with the deterministic result, clearing the gate with zero errors", async () => {
    const run = await Eval.create({
      name: "fixture-provider-fallback",
      dataset: [
        {
          input: "Use provider fallback.",
          expected: "Falling back to alternate provider.",
        },
      ],
      scorers: [Scorers.exactMatch(), Scorers.containsExpected(), Scorers.regex(/falling back/i)],
      agent: FIXTURE_AGENT,
      concurrency: 1,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
    expect(run.aggregate.totalRows).toBe(1);
  });
});
