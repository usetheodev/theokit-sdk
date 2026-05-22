/**
 * CLI eval runner — post-D212 swap. Tests validate the shape adaptation
 * from SDK's `EvalRun` to CLI's `EvalRunResult`.
 *
 * Since the runner now calls `Eval.run` which internally uses `Agent.batch`,
 * we rely on the SDK's fixture-mode (apiKey starting with `theo_test_`) for
 * deterministic responses. No vi.mock needed — the SDK is exercised end-to-end.
 *
 * EC-K (async scorer) still validated.
 */

import { describe, expect, it } from "vitest";

import { runEvalSuite } from "../../src/eval/runner.js";
import type { EvalConfig } from "../../src/eval/types.js";

const FIXTURE_AGENT = {
  apiKey: "theo_test_dummy",
  model: { id: "openai/gpt-4o-mini" },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
} as const;

describe("runEvalSuite (post-D212 swap)", () => {
  it("returns empty aggregate when dataset is empty", async () => {
    const config: EvalConfig = {
      dataset: [],
      scorers: [],
      agent: FIXTURE_AGENT as never,
    };
    const result = await runEvalSuite(config);
    expect(result.rows).toEqual([]);
    expect(result.aggregate.totalRows).toBe(0);
  });

  it("applies a sync scorer over fixture-mode batch", async () => {
    const config: EvalConfig = {
      dataset: [{ input: "hi" }],
      scorers: [
        {
          name: "always-1",
          score: () => ({ score: 1 }),
        },
      ],
      agent: FIXTURE_AGENT as never,
    };
    const result = await runEvalSuite(config);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.scores[0]?.score).toBe(1);
    expect(result.aggregate.meanScore).toBe(1);
  });

  it("EC-K: supports async scorer (returns Promise<Score>)", async () => {
    const config: EvalConfig = {
      dataset: [{ input: "test" }],
      scorers: [
        {
          name: "async-passes",
          score: async () => {
            await Promise.resolve();
            return { score: 1 };
          },
        },
      ],
      agent: FIXTURE_AGENT as never,
    };
    const result = await runEvalSuite(config);
    expect(result.rows[0]?.scores[0]?.score).toBe(1);
  });

  it("EC-K: async scorer that rejects → score=0 with diagnostic reason", async () => {
    const config: EvalConfig = {
      dataset: [{ input: "test" }],
      scorers: [
        {
          name: "throws",
          score: async () => {
            throw new Error("intentional");
          },
        },
      ],
      agent: FIXTURE_AGENT as never,
    };
    const result = await runEvalSuite(config);
    expect(result.rows[0]?.scores[0]?.score).toBe(0);
    expect(result.rows[0]?.scores[0]?.reason).toMatch(/scorer/);
  });

  it("aggregates pass ratio at threshold 0.5", async () => {
    const config: EvalConfig = {
      dataset: [{ input: "a" }, { input: "b" }, { input: "c" }],
      scorers: [
        {
          name: "varies",
          // Round-robin: 1, 0.5, 0 based on input
          score: (out, expected): { score: number } => {
            // Output is fixture-determined; we score independently on input identity by passing
            // expected. But scorer doesn't see input; we just emit a fixed pattern.
            return { score: 0.5 };
          },
        },
      ],
      agent: FIXTURE_AGENT as never,
    };
    const result = await runEvalSuite(config);
    expect(result.aggregate.totalRows).toBe(3);
    // All scored 0.5 → all "pass" by the >= 0.5 threshold
    expect(result.aggregate.passRatio).toBe(1);
  });
});
