/**
 * SE41 — deterministic fuzzy scorers: `Scorers.levenshtein` + `Scorers.numericDiff`.
 *
 * These run WITHOUT any LLM, so they always execute in CI. Given-When-Then.
 */

import { describe, expect, it } from "vitest";

import { Scorers } from "../../src/scorers.js";

describe("Scorers.levenshtein (SE41)", () => {
  it("scores identical strings 1.0", async () => {
    const s = Scorers.levenshtein();
    expect(await s.score("hello world", "hello world")).toEqual({ score: 1 });
  });

  it("scores by normalized edit distance (kitten vs sitting = 1 - 3/7)", async () => {
    const s = Scorers.levenshtein({ caseSensitive: true });
    const r = await s.score("kitten", "sitting");
    expect(r.score).toBeCloseTo(1 - 3 / 7, 6);
  });

  it("is case-insensitive by default", async () => {
    const s = Scorers.levenshtein();
    expect((await s.score("ABC", "abc")).score).toBe(1);
  });

  it("respects caseSensitive: true", async () => {
    const s = Scorers.levenshtein({ caseSensitive: true });
    expect((await s.score("ABC", "abc")).score).toBe(0);
  });

  it("threshold binarizes: sim >= threshold => 1", async () => {
    const pass = Scorers.levenshtein({ threshold: 0.5, caseSensitive: true });
    expect((await pass.score("kitten", "sitting")).score).toBe(1); // 0.571 >= 0.5
    const fail = Scorers.levenshtein({ threshold: 0.9, caseSensitive: true });
    expect((await fail.score("kitten", "sitting")).score).toBe(0); // 0.571 < 0.9
  });

  it("refuses non-string expected", async () => {
    const s = Scorers.levenshtein();
    expect(await s.score("x", 42)).toEqual({ score: 0, reason: "expected_not_string" });
  });

  it("refuses empty expected (EC-1 parity)", async () => {
    const s = Scorers.levenshtein();
    expect(await s.score("x", "")).toEqual({ score: 0, reason: "expected_empty" });
  });

  it("caps oversized input rather than doing O(n*m) work", async () => {
    const big = "a".repeat(20_000);
    const s = Scorers.levenshtein();
    expect((await s.score(big, "b")).reason).toBe("input_too_large");
  });
});

describe("Scorers.numericDiff (SE41)", () => {
  it("scores exact numeric match 1.0 (string vs number expected)", async () => {
    const s = Scorers.numericDiff();
    expect((await s.score("42", 42)).score).toBe(1);
  });

  it("scores continuous relative difference", async () => {
    const s = Scorers.numericDiff();
    // diff 2, denom max(10,8)=10 => 1 - 0.2
    expect((await s.score("10", 8)).score).toBeCloseTo(0.8, 6);
  });

  it("both zero => 1.0", async () => {
    const s = Scorers.numericDiff();
    expect((await s.score("0", 0)).score).toBe(1);
  });

  it("tolerance binarizes within band", async () => {
    const s = Scorers.numericDiff({ tolerance: 1 });
    expect((await s.score("10", 9.5)).score).toBe(1);
    expect((await s.score("10", 8)).score).toBe(0);
  });

  it("refuses non-numeric output", async () => {
    const s = Scorers.numericDiff();
    expect((await s.score("not a number", 5)).reason).toBe("output_not_numeric");
  });

  it("refuses non-numeric expected", async () => {
    const s = Scorers.numericDiff();
    expect((await s.score("5", "five")).reason).toBe("expected_not_numeric");
  });
});
