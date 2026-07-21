/**
 * SE41 eval suite — TOOL pipeline via fixture mode (deterministic).
 *
 * "report the exported answer" drives the agent through the shell tool and
 * returns "The answer is 42." — exercising the real tool-call loop with no
 * token spend. Scored on the answer content.
 */

import { describe, expect, it } from "vitest";

import { assertEval, Eval, Scorers } from "../../../src/eval.js";

const FIXTURE_AGENT = {
  apiKey: "theo_test_eval",
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
} as const;

describe("eval suite: agent tools (fixture mode)", () => {
  it("tool pipeline: agent reports the exported answer and clears the gate", async () => {
    const run = await Eval.create({
      name: "fixture-tools",
      dataset: [{ input: "report the exported answer", expected: "42" }],
      scorers: [Scorers.containsExpected(), Scorers.regex(/answer/i)],
      agent: FIXTURE_AGENT,
      concurrency: 1,
    }).run();

    assertEval(run, { minPassRatio: 1, maxErrorRatio: 0 });
    expect(run.aggregate.errorRows).toBe(0);
  });
});
