import { describe, expect, it } from "vitest";

import {
  type CompositeScoreConfig,
  compositeScore,
  DEFAULT_COMPOSITE_CONFIG,
} from "../src/internal/active-memory/composite-scorer.js";

describe("compositeScore", () => {
  const config = DEFAULT_COMPOSITE_CONFIG;

  it("recent memory ranks higher than old with equal vector scores", () => {
    const now = Date.now();
    const recent = compositeScore(0.8, 0.5, now - 1000, 0.5, config);
    const old = compositeScore(0.8, 0.5, now - 90 * 24 * 60 * 60 * 1000, 0.5, config);
    expect(recent).toBeGreaterThan(old);
  });

  it("important memory ranks higher", () => {
    const now = Date.now();
    const important = compositeScore(0.8, 0.5, now, 1.0, config);
    const unimportant = compositeScore(0.8, 0.5, now, 0.1, config);
    expect(important).toBeGreaterThan(unimportant);
  });

  it("at exact half-life, recency = 0.5", () => {
    const now = Date.now();
    const halfLife = config.recencyHalfLifeMs;
    const score = compositeScore(1.0, 0.0, now - halfLife, 0.0, config);
    const expected = config.semanticWeight * 1.0 + config.recencyWeight * 0.5;
    expect(score).toBeCloseTo(expected, 5);
  });

  it("just created → recency ≈ 1.0", () => {
    const score = compositeScore(0.0, 0.0, Date.now(), 0.0, config);
    expect(score).toBeCloseTo(config.recencyWeight * 1.0, 2);
  });

  it("null created_at → recency = 0.5 (neutral for legacy data)", () => {
    const score = compositeScore(0.0, 0.0, null, 0.0, config);
    expect(score).toBeCloseTo(config.recencyWeight * 0.5, 5);
  });

  it("backward-compat: legacy weights reproduce old scoring", () => {
    const legacy: CompositeScoreConfig = {
      semanticWeight: 0.6,
      textWeight: 0.4,
      recencyWeight: 0,
      importanceWeight: 0,
      recencyHalfLifeMs: 30 * 24 * 60 * 60 * 1000,
    };
    const score = compositeScore(0.9, 0.7, Date.now(), 1.0, legacy);
    const expected = 0.6 * 0.9 + 0.4 * 0.7;
    expect(Math.abs(score - expected)).toBeLessThan(0.001);
  });

  it("uses default config when not provided", () => {
    expect(DEFAULT_COMPOSITE_CONFIG.semanticWeight).toBe(0.5);
    expect(DEFAULT_COMPOSITE_CONFIG.textWeight).toBe(0.2);
    expect(DEFAULT_COMPOSITE_CONFIG.recencyWeight).toBe(0.2);
    expect(DEFAULT_COMPOSITE_CONFIG.importanceWeight).toBe(0.1);
  });

  it("output is bounded for normalized inputs", () => {
    const score = compositeScore(1.0, 1.0, Date.now(), 1.0, config);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1.1);
  });
});
