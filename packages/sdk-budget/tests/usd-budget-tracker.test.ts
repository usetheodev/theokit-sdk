/**
 * `createUsdBudgetTracker` end-to-end tests (SDK 2.0 Phase 2 / T2.X —
 * first concrete BudgetTracker impl shipped in @theokit/sdk-budget).
 *
 * Mirrors `budget-tracker-counter.test.ts` (sdk-core iter 11) with
 * USD-cost semantics added:
 *   - track() accumulates USD via the pricing table
 *   - check() returns cost_limit when maxUsd exceeded
 *   - getTotalUsd() exposes cumulative spend
 *   - pricing override merges onto BUILTIN_PRICING
 */

import type { BudgetTracker } from "@theokit/sdk";
import {
  BUILTIN_PRICING,
  computeUsdCost,
  createUsdBudgetTracker,
  type ModelPricing,
  type UsdBudgetTrackerOptions,
} from "@theokit/sdk-budget";
import { describe, expect, it } from "vitest";

describe("computeUsdCost (pure helper)", () => {
  it("test_known_model_input_tokens_compute_correctly", () => {
    // openai/gpt-4o-mini = 0.15 / 0.6 per 1M
    const cost = computeUsdCost(BUILTIN_PRICING, "openai/gpt-4o-mini", "input", 1_000_000);
    expect(cost).toBeCloseTo(0.15, 6);
  });

  it("test_known_model_output_tokens_compute_correctly", () => {
    const cost = computeUsdCost(BUILTIN_PRICING, "openai/gpt-4o-mini", "output", 1_000_000);
    expect(cost).toBeCloseTo(0.6, 6);
  });

  it("test_unknown_model_returns_zero", () => {
    const cost = computeUsdCost(BUILTIN_PRICING, "nonexistent/model", "input", 1_000_000);
    expect(cost).toBe(0);
  });

  it("test_invalid_tokens_return_zero", () => {
    expect(computeUsdCost(BUILTIN_PRICING, "openai/gpt-4o-mini", "input", -1)).toBe(0);
    expect(computeUsdCost(BUILTIN_PRICING, "openai/gpt-4o-mini", "input", Number.NaN)).toBe(0);
    expect(
      computeUsdCost(BUILTIN_PRICING, "openai/gpt-4o-mini", "input", Number.POSITIVE_INFINITY),
    ).toBe(0);
  });

  it("test_proportional_scaling_for_partial_million", () => {
    // 100k tokens of gpt-4o-mini input = 0.1 * 0.15 = 0.015
    const cost = computeUsdCost(BUILTIN_PRICING, "openai/gpt-4o-mini", "input", 100_000);
    expect(cost).toBeCloseTo(0.015, 6);
  });
});

describe("createUsdBudgetTracker (BudgetTracker impl)", () => {
  it("test_factory_returns_independent_trackers", () => {
    const a = createUsdBudgetTracker();
    const b = createUsdBudgetTracker();
    expect(a).not.toBe(b);
    expect(a.getTotalUsd()).toBe(0);
    expect(b.getTotalUsd()).toBe(0);
  });

  it("test_satisfies_BudgetTracker_contract", () => {
    const tracker: BudgetTracker = createUsdBudgetTracker();
    expect(typeof tracker.track).toBe("function");
    expect(typeof tracker.check).toBe("function");
    expect(typeof tracker.getTotal).toBe("function");
  });

  it("test_track_accumulates_tokens_and_usd", () => {
    const tracker = createUsdBudgetTracker();
    tracker.track({ tokens: 1_000_000, model: "openai/gpt-4o-mini", type: "input" });
    tracker.track({ tokens: 1_000_000, model: "openai/gpt-4o-mini", type: "output" });
    expect(tracker.getTotal().tokens).toBe(2_000_000);
    // 1M input @ 0.15 + 1M output @ 0.6 = 0.75
    expect(tracker.getTotalUsd()).toBeCloseTo(0.75, 6);
  });

  it("test_check_returns_allowed_when_no_caps_exceeded", () => {
    const tracker = createUsdBudgetTracker({ maxTokens: 10_000_000, maxUsd: 100 });
    tracker.track({ tokens: 1000, model: "openai/gpt-4o-mini", type: "input" });
    expect(tracker.check()).toEqual({ allowed: true });
  });

  it("test_check_returns_cost_limit_when_maxUsd_exceeded", () => {
    const tracker = createUsdBudgetTracker({ maxUsd: 0.1 });
    // 1M output of gpt-4o-mini = $0.60, exceeds $0.10 cap
    tracker.track({ tokens: 1_000_000, model: "openai/gpt-4o-mini", type: "output" });
    const decision = tracker.check();
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("cost_limit");
      expect(decision.detail).toContain("USD");
    }
  });

  it("test_check_returns_token_limit_when_maxTokens_exceeded", () => {
    const tracker = createUsdBudgetTracker({ maxTokens: 100 });
    tracker.track({ tokens: 200, model: "openai/gpt-4o-mini", type: "input" });
    const decision = tracker.check();
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("token_limit");
    }
  });

  it("test_cost_limit_takes_precedence_over_token_limit", () => {
    // Both caps would be exceeded — cost reason wins (USD is the more
    // expensive signal to a human reading logs).
    const tracker = createUsdBudgetTracker({ maxTokens: 100, maxUsd: 0.001 });
    tracker.track({ tokens: 1_000_000, model: "openai/gpt-4o-mini", type: "output" });
    const decision = tracker.check();
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("cost_limit");
    }
  });

  it("test_unknown_model_track_zero_usd_still_counts_tokens", () => {
    const tracker = createUsdBudgetTracker({ maxTokens: 10_000 });
    tracker.track({ tokens: 500, model: "unknown/model", type: "input" });
    expect(tracker.getTotalUsd()).toBe(0);
    expect(tracker.getTotal().tokens).toBe(500);
  });

  it("test_pricing_override_merges_onto_builtin", () => {
    const customPricing: Record<string, ModelPricing> = {
      "fake/expensive": { inputPerMillionUsd: 100, outputPerMillionUsd: 200 },
    };
    const opts: UsdBudgetTrackerOptions = { pricing: customPricing };
    const tracker = createUsdBudgetTracker(opts);
    tracker.track({ tokens: 1_000_000, model: "fake/expensive", type: "input" });
    expect(tracker.getTotalUsd()).toBeCloseTo(100, 6);
    // Built-in still works
    tracker.track({ tokens: 1_000_000, model: "openai/gpt-4o-mini", type: "input" });
    expect(tracker.getTotalUsd()).toBeCloseTo(100.15, 6);
  });

  it("test_pricing_override_can_replace_builtin_entry", () => {
    const overridden: Record<string, ModelPricing> = {
      "openai/gpt-4o-mini": { inputPerMillionUsd: 999, outputPerMillionUsd: 999 },
    };
    const tracker = createUsdBudgetTracker({ pricing: overridden });
    tracker.track({ tokens: 1_000_000, model: "openai/gpt-4o-mini", type: "input" });
    expect(tracker.getTotalUsd()).toBeCloseTo(999, 6);
  });

  it("test_invalid_track_silently_clamped", () => {
    const tracker = createUsdBudgetTracker();
    tracker.track({ tokens: Number.NaN, model: "openai/gpt-4o-mini", type: "input" });
    tracker.track({ tokens: -1, model: "openai/gpt-4o-mini", type: "input" });
    tracker.track({ tokens: 0, model: "openai/gpt-4o-mini", type: "input" });
    expect(tracker.getTotal().tokens).toBe(0);
    expect(tracker.getTotalUsd()).toBe(0);
  });

  it("test_nextIteration_increments_independently", () => {
    const tracker = createUsdBudgetTracker({ maxTokens: 1000 });
    tracker.nextIteration();
    tracker.nextIteration();
    tracker.nextIteration();
    expect(tracker.getTotal().iterations).toBe(3);
    expect(tracker.check()).toEqual({ allowed: true });
  });

  it("test_lifecycle_smoke_real_scenario", () => {
    // Simulate a 4-turn agent run with gpt-4o-mini, capped at $0.05
    const tracker = createUsdBudgetTracker({ maxUsd: 0.05 });
    const model = "openai/gpt-4o-mini";

    // Turn 1: 500 in, 200 out → $0.000075 + $0.00012 = $0.000195
    tracker.track({ tokens: 500, model, type: "input" });
    tracker.track({ tokens: 200, model, type: "output" });
    expect(tracker.check()).toEqual({ allowed: true });

    // Turn 2-3-4 — keep adding (still under cap)
    for (let i = 0; i < 3; i++) {
      tracker.track({ tokens: 500, model, type: "input" });
      tracker.track({ tokens: 200, model, type: "output" });
      expect(tracker.check()).toEqual({ allowed: true });
    }

    // Cumulative: 4 × $0.000195 = $0.00078 (well under $0.05)
    expect(tracker.getTotalUsd()).toBeCloseTo(0.00078, 6);
  });
});
