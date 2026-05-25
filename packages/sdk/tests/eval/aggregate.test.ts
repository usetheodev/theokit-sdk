/**
 * D211 aggregate + EC-6 clampScore.
 */

import { describe, expect, it } from "vitest";

import { clampScore, computeAggregate } from "../../src/internal/eval/aggregate.js";
import type { EvalRowResult } from "../../src/types/eval.js";

function row(
  meanScore: number,
  durationMs: number,
  opts: Partial<EvalRowResult> = {},
): EvalRowResult {
  return {
    index: 0,
    input: "x",
    output: "y",
    scores: [{ name: "s", score: meanScore }],
    meanScore,
    durationMs,
    ...opts,
  };
}

describe("computeAggregate (D211)", () => {
  it("EC-7: empty rows yields zero aggregate (not NaN)", () => {
    const agg = computeAggregate([]);
    expect(agg.totalRows).toBe(0);
    expect(agg.meanScore).toBe(0);
    expect(agg.medianScore).toBe(0);
    expect(agg.passRatio).toBe(0);
    expect(agg.durationMsP50).toBe(0);
    expect(agg.durationMsP95).toBe(0);
    expect(Number.isNaN(agg.meanScore)).toBe(false);
  });

  it("computes mean / median / passRatio across rows", () => {
    const rows = [row(0.2, 10), row(0.4, 20), row(0.7, 30), row(1.0, 40)];
    const agg = computeAggregate(rows);
    expect(agg.totalRows).toBe(4);
    expect(agg.meanScore).toBeCloseTo(0.575, 3);
    expect(agg.passRatio).toBeCloseTo(0.5, 3); // 2 rows >= 0.5
  });

  it("computes p50 and p95 from durations", () => {
    const rows = [row(1, 10), row(1, 20), row(1, 30), row(1, 100), row(1, 200)];
    const agg = computeAggregate(rows);
    // Nearest-rank: ceil(0.5 * 5) - 1 = 2 → sorted[2] = 30
    expect(agg.durationMsP50).toBe(30);
    // ceil(0.95 * 5) - 1 = 4 → sorted[4] = 200
    expect(agg.durationMsP95).toBe(200);
  });

  it("aggregates per-scorer breakdown", () => {
    const rows: EvalRowResult[] = [
      {
        index: 0,
        input: "a",
        output: "b",
        scores: [
          { name: "scorer-a", score: 1.0 },
          { name: "scorer-b", score: 0.5 },
        ],
        meanScore: 0.75,
        durationMs: 10,
      },
      {
        index: 1,
        input: "a",
        output: "b",
        scores: [
          { name: "scorer-a", score: 0.0 },
          { name: "scorer-b", score: 0.0 },
        ],
        meanScore: 0,
        durationMs: 10,
      },
    ];
    const agg = computeAggregate(rows);
    expect(agg.perScorer["scorer-a"]?.mean).toBeCloseTo(0.5, 3);
    expect(agg.perScorer["scorer-b"]?.mean).toBeCloseTo(0.25, 3);
    expect(agg.perScorer["scorer-a"]?.max).toBe(1.0);
    expect(agg.perScorer["scorer-a"]?.min).toBe(0.0);
  });

  it("sums tokensIn / tokensOut totals", () => {
    const rows: EvalRowResult[] = [
      { ...row(1, 10), tokensIn: 100, tokensOut: 50 },
      { ...row(1, 10), tokensIn: 200, tokensOut: 80 },
      { ...row(1, 10) }, // tokens undefined
    ];
    const agg = computeAggregate(rows);
    expect(agg.tokensInTotal).toBe(300);
    expect(agg.tokensOutTotal).toBe(130);
  });

  it("counts errorRows correctly", () => {
    const rows = [row(0, 10, { error: "boom" }), row(1, 10), row(0, 10, { error: "boom2" })];
    const agg = computeAggregate(rows);
    expect(agg.errorRows).toBe(2);
  });

  it("single-row p50 = p95 = that row", () => {
    const agg = computeAggregate([row(0.5, 42)]);
    expect(agg.durationMsP50).toBe(42);
    expect(agg.durationMsP95).toBe(42);
  });
});

describe("clampScore (EC-6)", () => {
  it("passes through valid score", () => {
    expect(clampScore({ score: 0.5 })).toEqual({ score: 0.5 });
  });

  it("clamps NaN to 0 with reason", () => {
    const r = clampScore({ score: Number.NaN });
    expect(r.score).toBe(0);
    expect(r.reason).toBe("score_not_finite");
  });

  it("clamps Infinity to 0 with reason", () => {
    const r = clampScore({ score: Number.POSITIVE_INFINITY });
    expect(r.score).toBe(0);
    expect(r.reason).toBe("score_not_finite");
  });

  it("clamps negative to 0 with reason", () => {
    const r = clampScore({ score: -5 });
    expect(r.score).toBe(0);
    expect(r.reason).toBe("score_below_zero");
  });

  it("clamps > 1 to 1 with reason", () => {
    const r = clampScore({ score: 2 });
    expect(r.score).toBe(1);
    expect(r.reason).toBe("score_above_one");
  });

  it("preserves caller reason on clamp", () => {
    const r = clampScore({ score: -1, reason: "custom" });
    expect(r.score).toBe(0);
    expect(r.reason).toBe("custom");
  });
});
