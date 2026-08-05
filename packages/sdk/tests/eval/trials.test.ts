/**
 * SE41 — `EvalOptions.trials`: repeat each dataset row N times, then COLLAPSE
 * to one row whose per-scorer score is the mean over the N trials (an errored
 * trial contributes 0 — a reliability signal).
 *
 * Determinism: a stateful counting agent + concurrency 1 makes the N trial
 * outputs a fixed sequence, so the collapsed mean is exact.
 */

import { describe, expect, it } from "vitest";

import { Eval } from "../../src/eval.js";
import type { SDKAgent } from "../../src/types/agent.js";
import type { NamedScorer } from "../../src/types/eval.js";

/** Emits "0","1","2",... one per send() — sequential under concurrency 1. */
function countingAgent(): SDKAgent {
  let n = 0;
  return {
    agentId: "agent-count",
    send: (_input: string) => {
      const v = n;
      n += 1;
      return Promise.resolve({
        wait: () => Promise.resolve({ status: "finished" as const, result: String(v) }),
      });
    },
  } as unknown as SDKAgent;
}

/** Scores 1 when the numeric output is even, else 0. */
const evenScorer: NamedScorer = {
  name: "even",
  score: (o) => ({ score: Number(o) % 2 === 0 ? 1 : 0 }),
};

describe("EvalOptions.trials (SE41)", () => {
  it("collapses N trials into ONE row with the per-scorer mean", async () => {
    const run = await Eval.create({
      name: "trials-collapse",
      dataset: [{ input: "x", metadata: { tag: "keep" } }],
      scorers: [evenScorer],
      agent: countingAgent(),
      concurrency: 1,
      trials: 4, // outputs 0,1,2,3 -> even scores 1,0,1,0 -> mean 0.5
    }).run();

    expect(run.rows).toHaveLength(1);
    const row = run.rows[0];
    expect(row?.trialCount).toBe(4);
    expect(row?.scores[0]?.score).toBeCloseTo(0.5, 6);
    expect(row?.meanScore).toBeCloseTo(0.5, 6);
    expect(run.aggregate.totalRows).toBe(1);
  });

  it("strips reserved __eval* keys from the collapsed row metadata", async () => {
    const run = await Eval.create({
      name: "trials-metadata",
      dataset: [{ input: "x", metadata: { tag: "keep" } }],
      scorers: [evenScorer],
      agent: countingAgent(),
      concurrency: 1,
      trials: 2,
    }).run();

    expect(run.rows[0]?.metadata).toEqual({ tag: "keep" });
  });

  it("an errored trial contributes 0 (reliability), row is not marked errored on partial success", async () => {
    let n = 0;
    const flakyAgent = {
      agentId: "agent-flaky",
      send: (_input: string) => {
        const v = n;
        n += 1;
        return Promise.resolve({
          wait: () =>
            Promise.resolve(
              v % 2 === 0
                ? { status: "finished" as const, result: "1" }
                : { status: "error" as const, error: { message: "boom" } },
            ),
        });
      },
    } as unknown as SDKAgent;

    const run = await Eval.create({
      name: "trials-flaky",
      dataset: [{ input: "x" }],
      scorers: [{ name: "is-one", score: (o) => ({ score: o === "1" ? 1 : 0 }) }],
      agent: flakyAgent,
      concurrency: 1,
      trials: 2, // trial0 ok (score 1), trial1 errors (contributes 0) -> mean 0.5
    }).run();

    const row = run.rows[0];
    expect(row?.scores[0]?.score).toBeCloseTo(0.5, 6);
    expect(row?.error).toBeUndefined();
    expect(row?.trialCount).toBe(2);
  });

  it("trials: 1 is byte-identical (no trialCount field)", async () => {
    const run = await Eval.create({
      name: "trials-one",
      dataset: [{ input: "x" }],
      scorers: [evenScorer],
      agent: countingAgent(),
      concurrency: 1,
      trials: 1,
    }).run();

    expect(run.rows[0]?.trialCount).toBeUndefined();
  });

  it("validates trials: rejects 0, non-integer, and > 100", () => {
    const base = {
      name: "trials-validate",
      dataset: [{ input: "x" }],
      scorers: [evenScorer],
      agent: countingAgent(),
    } as const;
    expect(() => Eval.create({ ...base, trials: 0 })).toThrow(/trials/);
    expect(() => Eval.create({ ...base, trials: 1.5 })).toThrow(/trials/);
    expect(() => Eval.create({ ...base, trials: 101 })).toThrow(/trials/);
  });
});
