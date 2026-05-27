/**
 * Phase 4 (T4.2) — UsageAccumulator multi-step aggregation tests.
 */

import { describe, expect, it } from "vitest";
import { UsageAccumulator } from "../../../src/internal/budget/usage-accumulator.js";

describe("UsageAccumulator", () => {
  it("single step: no requests[] field", () => {
    const acc = new UsageAccumulator();
    acc.add({ inputTokens: 100, outputTokens: 50 });
    const u = acc.toTokenUsage();
    expect(u.inputTokens).toBe(100);
    expect(u.outputTokens).toBe(50);
    expect(u.totalTokens).toBe(150);
    expect(u.requests).toBeUndefined();
  });

  it("multi-step: requests[] populated, totals aggregated", () => {
    const acc = new UsageAccumulator();
    acc.add({ inputTokens: 100, outputTokens: 50 });
    acc.add({ inputTokens: 200, outputTokens: 75 });
    acc.add({ inputTokens: 50, outputTokens: 25 });
    const u = acc.toTokenUsage();
    expect(u.inputTokens).toBe(350);
    expect(u.outputTokens).toBe(150);
    expect(u.totalTokens).toBe(500);
    expect(u.requests?.length).toBe(3);
    expect(u.requests?.[0]?.inputTokens).toBe(100);
  });

  it("aggregates cache + reasoning across steps", () => {
    const acc = new UsageAccumulator();
    acc.add({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 200 });
    acc.add({ inputTokens: 100, outputTokens: 50, cacheWriteTokens: 30, reasoningTokens: 10 });
    const u = acc.toTokenUsage();
    expect(u.cacheReadTokens).toBe(200);
    expect(u.cacheWriteTokens).toBe(30);
    expect(u.reasoningTokens).toBe(10);
  });

  it("omits undefined buckets when zero", () => {
    const acc = new UsageAccumulator();
    acc.add({ inputTokens: 100, outputTokens: 50 });
    const u = acc.toTokenUsage();
    expect(u.cacheReadTokens).toBeUndefined();
    expect(u.cacheWriteTokens).toBeUndefined();
    expect(u.reasoningTokens).toBeUndefined();
  });

  it("hasAny() reflects whether any step was added", () => {
    const acc = new UsageAccumulator();
    expect(acc.hasAny()).toBe(false);
    acc.add({ inputTokens: 0, outputTokens: 0 });
    expect(acc.hasAny()).toBe(true);
  });
});
