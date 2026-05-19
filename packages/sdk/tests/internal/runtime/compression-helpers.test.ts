/**
 * Tests for compression-helpers (T2.3, ADR D92).
 */

import { describe, expect, it } from "vitest";

import {
  assertCompressionReduced,
  selectCompressionWindow,
} from "../../../src/internal/runtime/compression-helpers.js";

describe("selectCompressionWindow (T2.3)", () => {
  it("short history preserves all", () => {
    const result = selectCompressionWindow([1, 2, 3], 6);
    expect(result.toCompress).toEqual([]);
    expect(result.toPreserve).toEqual([1, 2, 3]);
  });

  it("splits correctly when over threshold", () => {
    const result = selectCompressionWindow([1, 2, 3, 4, 5, 6, 7, 8], 6);
    expect(result.toCompress).toEqual([1, 2]);
    expect(result.toPreserve).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("default preserves last 6", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => i);
    const result = selectCompressionWindow(msgs);
    expect(result.toCompress.length).toBe(4);
    expect(result.toPreserve.length).toBe(6);
  });
});

describe("assertCompressionReduced (T2.3)", () => {
  it("reduction above threshold ok", () => {
    const r = assertCompressionReduced(100, 50, 10);
    expect(r.reduced).toBe(true);
    expect(r.reductionPct).toBe(50);
  });

  it("reduction below threshold flagged", () => {
    const r = assertCompressionReduced(100, 95, 10);
    expect(r.reduced).toBe(false);
    expect(r.reductionPct).toBe(5);
    expect(r.reason).toContain("Spiral likely");
  });

  it("reduction exact threshold treated as ok", () => {
    const r = assertCompressionReduced(100, 90, 10);
    expect(r.reduced).toBe(true);
    expect(r.reductionPct).toBe(10);
  });
});
