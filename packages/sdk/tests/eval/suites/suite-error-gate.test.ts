/**
 * SE41 eval suite — the ERROR-RATE gate (deterministic).
 *
 * A canned agent that errors proves row-error isolation (a failing row never
 * aborts the eval) and that `assertEval`'s `maxErrorRatio` ceiling catches
 * reliability regressions. Zero token spend.
 */

import { describe, expect, it } from "vitest";

import { assertEval, Eval, EvalThresholdError, Scorers } from "../../../src/eval.js";
import type { SDKAgent } from "../../../src/types/agent.js";

/** Always errors — drives the manual run path to an errored row. */
const erroringAgent = {
  agentId: "agent-err",
  send: (_input: string) =>
    Promise.resolve({
      wait: () => Promise.resolve({ status: "error" as const, error: { message: "boom" } }),
    }),
} as unknown as SDKAgent;

describe("eval suite: error-rate gate", () => {
  it("isolates row errors and trips maxErrorRatio", async () => {
    const run = await Eval.create({
      name: "error-gate",
      dataset: [
        { input: "a", expected: "x" },
        { input: "b", expected: "y" },
      ],
      scorers: [Scorers.exactMatch()],
      agent: erroringAgent,
      concurrency: 1,
    }).run();

    expect(run.aggregate.totalRows).toBe(2);
    expect(run.aggregate.errorRows).toBe(2);
    expect(() => assertEval(run, { maxErrorRatio: 0 })).toThrow(EvalThresholdError);
    expect(() => assertEval(run, { maxErrorRatio: 1 })).not.toThrow();
  });
});
