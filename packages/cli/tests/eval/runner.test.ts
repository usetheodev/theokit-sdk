/**
 * T5.1 eval runner tests + EC-K (async scorer support).
 */

import { describe, expect, it, vi } from "vitest";

import { runEvalSuite } from "../../src/eval/runner.js";
import type { EvalConfig } from "../../src/eval/types.js";

vi.mock("@usetheo/sdk", async () => {
  return {
    Agent: {
      batch: vi.fn(async (prompts: string[]) =>
        prompts.map((p, i) => ({
          ok: true as const,
          index: i,
          prompt: p,
          result: { id: `r${i}`, status: "finished" as const, result: `echoed: ${p}` },
          durationMs: 1,
        })),
      ),
    },
  };
});

describe("runEvalSuite (T5.1)", () => {
  it("returns empty aggregate when dataset is empty", async () => {
    const config: EvalConfig = {
      dataset: [],
      scorers: [],
      agent: { apiKey: "local", model: { id: "ollama/llama3.2:3b" } } as never,
    };
    const result = await runEvalSuite(config);
    expect(result.rows).toEqual([]);
    expect(result.aggregate.totalRows).toBe(0);
  });

  it("applies a sync scorer", async () => {
    const config: EvalConfig = {
      dataset: [{ input: "hi" }],
      scorers: [
        {
          name: "contains-hi",
          score: (out) => (out.includes("hi") ? { score: 1 } : { score: 0 }),
        },
      ],
      agent: { apiKey: "local", model: { id: "ollama/llama3.2:3b" } } as never,
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
          score: async (out) => {
            await Promise.resolve();
            return { score: out.length > 0 ? 1 : 0 };
          },
        },
      ],
      agent: { apiKey: "local", model: { id: "ollama/llama3.2:3b" } } as never,
    };
    const result = await runEvalSuite(config);
    expect(result.rows[0]?.scores[0]?.score).toBe(1);
  });

  it("EC-K: async scorer that rejects → score=0 with scorer_error reason", async () => {
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
      agent: { apiKey: "local", model: { id: "ollama/llama3.2:3b" } } as never,
    };
    const result = await runEvalSuite(config);
    expect(result.rows[0]?.scores[0]?.score).toBe(0);
    expect(result.rows[0]?.scores[0]?.reason).toContain("scorer_error");
  });

  it("aggregates pass ratio at threshold 0.5", async () => {
    const config: EvalConfig = {
      dataset: [{ input: "a" }, { input: "b" }, { input: "c" }],
      scorers: [
        {
          name: "ratio",
          score: (out) =>
            out.includes("a") ? { score: 1 } : out.includes("b") ? { score: 0.5 } : { score: 0 },
        },
      ],
      agent: { apiKey: "local", model: { id: "ollama/llama3.2:3b" } } as never,
    };
    const result = await runEvalSuite(config);
    expect(result.aggregate.totalRows).toBe(3);
    // a=1 (pass), b=0.5 (pass), c=0 (fail) → 2/3 pass
    expect(result.aggregate.passRatio).toBeCloseTo(2 / 3, 2);
  });
});
