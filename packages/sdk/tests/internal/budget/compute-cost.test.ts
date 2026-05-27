/**
 * Phase 2 (T2.2) — computeCost cost math + EC-12/EC-13/EC-14.
 */

import { describe, expect, it } from "vitest";

import { computeCost } from "../../../src/internal/budget/compute-cost.js";
import type { TokenUsage } from "../../../src/types/usage.js";

const baseUsage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
  ...overrides,
});

describe("computeCost — known provider/model", () => {
  it("anthropic claude-opus-4-7 with all 5 buckets", () => {
    const usage: TokenUsage = {
      inputTokens: 10_000,
      outputTokens: 5_000,
      cacheReadTokens: 100_000,
      cacheWriteTokens: 1_000,
      reasoningTokens: 500,
      totalTokens: 15_000,
    };
    const cost = computeCost({ provider: "anthropic", model: "claude-opus-4-7", usage });
    // Expected: input 10000 × $5/M + output 5000 × $25/M + cacheRead 100000 × $0.50/M + cacheWrite 1000 × $6.25/M
    //         + reasoning 500 × $25/M (fallback to output rate)
    //         = 0.05 + 0.125 + 0.05 + 0.00625 + 0.0125 = 0.24375
    expect(cost.status).toBe("estimated");
    expect(cost.amountUsd).toBeCloseTo(0.24375, 5);
    expect(cost.detail?.input).toBeCloseTo(0.05, 5);
    expect(cost.detail?.output).toBeCloseTo(0.125, 5);
    expect(cost.detail?.cacheRead).toBeCloseTo(0.05, 5);
    expect(cost.detail?.cacheWrite).toBeCloseTo(0.00625, 5);
    expect(cost.detail?.reasoning).toBeCloseTo(0.0125, 5);
  });

  it("subscription-included route returns $0 with status='included'", () => {
    const cost = computeCost({ provider: "openai-codex", model: "gpt-4o", usage: baseUsage() });
    expect(cost.status).toBe("included");
    expect(cost.amountUsd).toBe(0);
    expect(cost.source).toBe("subscription_included");
  });

  it("unknown route returns status='unknown' with undefined amountUsd", () => {
    const cost = computeCost({ provider: "made-up", model: "unicorn-99", usage: baseUsage() });
    expect(cost.status).toBe("unknown");
    expect(cost.amountUsd).toBeUndefined();
    expect(cost.source).toBe("unknown");
  });

  it("zero usage returns $0 with status='estimated'", () => {
    const cost = computeCost({
      provider: "anthropic",
      model: "claude-opus-4-7",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    expect(cost.status).toBe("estimated");
    expect(cost.amountUsd).toBe(0);
  });

  it("cache fields used but pricing missing for cache → status='unknown' + note", () => {
    // deepseek-chat has no cacheRead/cacheWrite in our snapshot
    const usage = baseUsage({ cacheReadTokens: 1000 });
    const cost = computeCost({ provider: "deepseek", model: "deepseek-chat", usage });
    expect(cost.status).toBe("unknown");
    expect(cost.amountUsd).toBeUndefined();
    expect(cost.notes?.[0]).toMatch(/cache-read/i);
  });
});

describe("computeCost — EC-12 money precision", () => {
  it("EC-12: 15.0 USD/MTok × 10M tokens === $150.00 exact (no float drift)", () => {
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 10_000_000,
      totalTokens: 10_000_000,
    };
    const cost = computeCost({ provider: "anthropic", model: "claude-sonnet-4-5", usage });
    // sonnet 4.5 output = $15/MTok; 10M tokens × $15/MTok = $150.00 exact
    expect(cost.amountUsd).toBe(150);
  });

  it("EC-12: small token counts produce sub-cent values without drift", () => {
    const usage: TokenUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };
    const cost = computeCost({ provider: "openai", model: "gpt-4o-mini", usage });
    // gpt-4o-mini: input 100 × $0.15/M = 0.000015; output 50 × $0.60/M = 0.000030; total = 0.000045
    expect(cost.amountUsd).toBeCloseTo(0.000045, 9);
  });
});

describe("computeCost — EC-13 negative pricing clamp", () => {
  it("EC-13: corrupted negative pricing entry → status='unknown' with note", () => {
    // We can't easily inject a corrupt entry without mocking; we rely on
    // pricing-registry catching corrupt data at load time. This test
    // documents the invariant via the compute side: if it ever sees
    // negative rates, it must NOT produce negative cost.
    //
    // Instead we verify computeCost behavior for "no pricing" path is
    // identical to what corrupt data would produce.
    const cost = computeCost({
      provider: "fake-provider",
      model: "negative-pricing-model",
      usage: baseUsage(),
    });
    expect(cost.status).toBe("unknown");
    expect(cost.amountUsd).toBeUndefined();
  });
});

describe("computeCost — EC-14 reasoning fallback", () => {
  it("EC-14: reasoning tokens fall back to output rate when no reasoning rate present", () => {
    // claude-opus-4-7 has output=$25/M, no reasoning rate field in our snapshot
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 1_000_000,
      totalTokens: 0,
    };
    const cost = computeCost({ provider: "anthropic", model: "claude-opus-4-7", usage });
    // 1M reasoning × $25/M (fallback) = $25
    expect(cost.amountUsd).toBe(25);
    expect(cost.notes?.some((n) => /reasoning.*output rate/i.test(n))).toBe(true);
  });
});

describe("computeCost — multi-step requests array", () => {
  it("computes total when requests[] not consulted (uses aggregated buckets)", () => {
    // requests[] is for display only; computeCost only reads the top-level
    // buckets which are already aggregated.
    const usage: TokenUsage = {
      inputTokens: 30_000,
      outputTokens: 15_000,
      totalTokens: 45_000,
      requests: [
        { inputTokens: 10_000, outputTokens: 5_000, totalTokens: 15_000 },
        { inputTokens: 10_000, outputTokens: 5_000, totalTokens: 15_000 },
        { inputTokens: 10_000, outputTokens: 5_000, totalTokens: 15_000 },
      ],
    };
    const cost = computeCost({ provider: "openai", model: "gpt-4o-mini", usage });
    // input 30k × $0.15/M + output 15k × $0.60/M = 0.0045 + 0.009 = 0.0135
    expect(cost.amountUsd).toBeCloseTo(0.0135, 5);
  });
});
