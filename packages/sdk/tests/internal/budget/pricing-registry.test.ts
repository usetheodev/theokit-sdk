/**
 * Phase 2 (T2.1) — pricing registry + alias normalization (EC-2/11).
 */

import { describe, expect, it } from "vitest";

import { getPricingEntry, pricingVersion } from "../../../src/internal/budget/pricing-registry.js";

describe("getPricingEntry — direct lookup", () => {
  it("anthropic/claude-opus-4-7 returns known entry with 5/25 rates", () => {
    const e = getPricingEntry({ provider: "anthropic", model: "claude-opus-4-7" });
    expect(e?.inputCostPerMillion).toBe(5);
    expect(e?.outputCostPerMillion).toBe(25);
    expect(e?.cacheReadCostPerMillion).toBe(0.5);
    expect(e?.cacheWriteCostPerMillion).toBe(6.25);
  });

  it("openai/gpt-4o-mini returns 0.15/0.60", () => {
    const e = getPricingEntry({ provider: "openai", model: "gpt-4o-mini" });
    expect(e?.inputCostPerMillion).toBe(0.15);
    expect(e?.outputCostPerMillion).toBe(0.6);
  });
});

describe("getPricingEntry — alias normalization (EC-2)", () => {
  it("EC-2: date-suffix strip claude-opus-4-7-20250507 → claude-opus-4-7", () => {
    const e = getPricingEntry({ provider: "anthropic", model: "claude-opus-4-7-20250507" });
    expect(e?.inputCostPerMillion).toBe(5);
  });

  it("EC-2: date-suffix strip gpt-4o-2024-08-06 → gpt-4o", () => {
    const e = getPricingEntry({ provider: "openai", model: "gpt-4o-2024-08-06" });
    expect(e?.inputCostPerMillion).toBe(2.5);
  });

  it("EC-2: Anthropic dot notation claude-opus-4.7 → claude-opus-4-7", () => {
    const e = getPricingEntry({ provider: "anthropic", model: "claude-opus-4.7" });
    expect(e?.inputCostPerMillion).toBe(5);
  });

  it("EC-2: Anthropic dot notation claude-sonnet-4.5", () => {
    const e = getPricingEntry({ provider: "anthropic", model: "claude-sonnet-4.5" });
    expect(e?.inputCostPerMillion).toBe(3);
  });
});

describe("getPricingEntry — OpenRouter prefix variants (EC-11)", () => {
  it("EC-11: openrouter/anthropic/claude-opus-4-7 strips prefix → anthropic/claude-opus-4-7", () => {
    const e = getPricingEntry({ provider: "openrouter", model: "anthropic/claude-opus-4-7" });
    expect(e?.inputCostPerMillion).toBe(5);
  });

  it("EC-11: openrouter/google/gemini-2.0-flash resolves", () => {
    const e = getPricingEntry({ provider: "openrouter", model: "google/gemini-2.0-flash" });
    expect(e?.inputCostPerMillion).toBe(0.1);
  });

  it("EC-11: model with openrouter/ prefix stripped before lookup", () => {
    const e = getPricingEntry({
      provider: "openrouter",
      model: "openrouter/anthropic/claude-opus-4-7",
    });
    expect(e?.inputCostPerMillion).toBe(5);
  });
});

describe("getPricingEntry — unknown / lazy load / version", () => {
  it("unknown model returns undefined", () => {
    expect(getPricingEntry({ provider: "anthropic", model: "claude-unicorn-99" })).toBeUndefined();
    expect(getPricingEntry({ provider: "made-up", model: "foo" })).toBeUndefined();
  });

  it("pricingVersion field present", () => {
    expect(pricingVersion()).toMatch(/litellm-2026/);
  });
});
