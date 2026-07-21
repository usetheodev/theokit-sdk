/**
 * SE41 — `assertEval(run, thresholds)`: the CI gate. A pure function over an
 * `EvalRun` that throws `EvalThresholdError` when any set threshold is unmet.
 */

import { describe, expect, it } from "vitest";

import { assertEval, EvalThresholdError } from "../../src/eval.js";
import type { EvalRun } from "../../src/types/eval.js";

/** Build a minimal EvalRun with a chosen aggregate — assertEval only reads aggregate. */
function makeRun(aggregate: Partial<EvalRun["aggregate"]>): EvalRun {
  return {
    id: "run-1",
    name: "gate-test",
    startedAt: 0,
    endedAt: 1,
    durationMs: 1,
    rows: [],
    aggregate: {
      meanScore: 1,
      medianScore: 1,
      passRatio: 1,
      perScorer: {},
      totalRows: 10,
      errorRows: 0,
      durationMsP50: 0,
      durationMsP95: 0,
      tokensInTotal: 0,
      tokensOutTotal: 0,
      ...aggregate,
    },
  };
}

describe("assertEval (SE41)", () => {
  it("passes silently when all thresholds are met", () => {
    const run = makeRun({ meanScore: 0.9, passRatio: 0.8 });
    expect(() => assertEval(run, { minMeanScore: 0.8, minPassRatio: 0.7 })).not.toThrow();
  });

  it("throws EvalThresholdError when meanScore is below the floor", () => {
    const run = makeRun({ meanScore: 0.6 });
    expect(() => assertEval(run, { minMeanScore: 0.8 })).toThrow(EvalThresholdError);
  });

  it("surfaces every failure, not just the first", () => {
    const run = makeRun({ meanScore: 0.5, passRatio: 0.4 });
    try {
      assertEval(run, { minMeanScore: 0.8, minPassRatio: 0.7 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EvalThresholdError);
      const err = e as EvalThresholdError;
      expect(err.failures.map((f) => f.metric).sort()).toEqual(["meanScore", "passRatio"]);
      expect(err.evalName).toBe("gate-test");
    }
  });

  it("checks maxErrorRatio (ceiling, not floor)", () => {
    const run = makeRun({ totalRows: 10, errorRows: 3 });
    expect(() => assertEval(run, { maxErrorRatio: 0.2 })).toThrow(EvalThresholdError);
    expect(() => assertEval(run, { maxErrorRatio: 0.3 })).not.toThrow();
  });

  it("checks per-scorer floors", () => {
    const run = makeRun({
      perScorer: {
        "exact-match": { mean: 0.9, median: 1, min: 0, max: 1 },
        "llm-judge": { mean: 0.4, median: 0.5, min: 0, max: 1 },
      },
    });
    expect(() => assertEval(run, { perScorer: { "exact-match": 0.8 } })).not.toThrow();
    expect(() => assertEval(run, { perScorer: { "llm-judge": 0.6 } })).toThrow(EvalThresholdError);
  });

  it("treats an absent named scorer as a failure (NaN actual)", () => {
    const run = makeRun({ perScorer: {} });
    try {
      assertEval(run, { perScorer: { "does-not-exist": 0.5 } });
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as EvalThresholdError;
      expect(err).toBeInstanceOf(EvalThresholdError);
      expect(err.failures[0]?.metric).toBe("perScorer.does-not-exist");
      expect(Number.isNaN(err.failures[0]?.actual ?? 0)).toBe(true);
    }
  });

  it("0 rows => error ratio 0 (never divides by zero)", () => {
    const run = makeRun({ totalRows: 0, errorRows: 0 });
    expect(() => assertEval(run, { maxErrorRatio: 0 })).not.toThrow();
  });
});
