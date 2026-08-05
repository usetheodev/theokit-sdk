/**
 * Eval suite — PROJECT-CONTEXT answering via FIXTURE MODE (deterministic, always runs).
 *
 * A `theo_test_*` API key runs the REAL local agent pipeline but returns
 * baked-in fixture responses (documented contract, like Stripe test keys), so
 * this suite exercises the context-aware answering path end to end with zero
 * token spend.
 *
 * The fixture dispatcher (`fixture-responder.ts`) matches the prompt substring
 * `"Answer using loaded project context"` and builds `contextAwareScript`, whose
 * deterministic result is:
 *   "The project uses deterministic contract tests for the Theo SDK."
 * The output is derived from the prompt alone — it does NOT depend on on-disk
 * context files — so no temp workspace is needed. The `context` config below
 * mirrors the context-manager contract test to exercise the same wiring.
 */

import { describe, expect, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";

const EXPECTED = "The project uses deterministic contract tests for the Theo SDK.";

const FIXTURE_AGENT = {
  apiKey: "theo_test_eval",
  model: { id: "openai/gpt-4o-mini" },
  context: {
    manager: "file" as const,
    maxTokens: 1200,
  },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
};

describe("eval suite: project-context answering (fixture mode)", () => {
  it("'Answer using loaded project context' returns the context-aware answer and clears the gate", async () => {
    const run = await Eval.create({
      name: "fixture-context-aware",
      dataset: [
        {
          input: "Answer using loaded project context: what kind of tests are used?",
          expected: EXPECTED,
        },
        {
          input: "Answer using loaded project context: describe the testing approach.",
          expected: EXPECTED,
        },
        {
          input: "Answer using loaded project context: how is the SDK verified?",
          expected: EXPECTED,
        },
      ],
      scorers: [
        Scorers.exactMatch(),
        Scorers.containsExpected(),
        Scorers.regex(/deterministic contract tests/i),
      ],
      agent: FIXTURE_AGENT,
      concurrency: 2,
    }).run();

    assertEval(run, { minMeanScore: 1, minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
    expect(run.aggregate.totalRows).toBe(3);
  });
});
