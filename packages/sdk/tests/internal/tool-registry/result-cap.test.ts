/**
 * Tests for applyResultCap (T2.4).
 */

import { describe, expect, it } from "vitest";

import { applyResultCap } from "../../../src/internal/tool-registry/result-cap.js";

describe("applyResultCap (T2.4)", () => {
  it("no-op under threshold", () => {
    expect(applyResultCap("hello", 100)).toBe("hello");
  });

  it("truncates over threshold", () => {
    const big = "x".repeat(200);
    const out = applyResultCap(big, 100);
    expect(out.length).toBeLessThan(200);
    expect(out.startsWith("x".repeat(100))).toBe(true);
  });

  it("marker includes omitted count", () => {
    const big = "x".repeat(150);
    const out = applyResultCap(big, 100);
    expect(out).toContain("[output truncated: 50 chars omitted]");
  });

  it("custom threshold", () => {
    const big = "x".repeat(50);
    expect(applyResultCap(big, 10)).toContain("[output truncated: 40 chars omitted]");
  });
});
