/**
 * Tests for TTL parser — units (s/m/h/d/w), number input,
 * EC-8 zero/negative handling.
 */

import { describe, expect, it } from "vitest";

import { parseTtlMs } from "../src/internal/ttl.js";
import { CacheInvalidTtlError } from "../src/types/cache.js";

describe("parseTtlMs", () => {
  it("parses seconds suffix", () => {
    expect(parseTtlMs("30s")).toBe(30_000);
  });

  it("parses minutes / hours / days / weeks", () => {
    expect(parseTtlMs("15m")).toBe(900_000);
    expect(parseTtlMs("1h")).toBe(3_600_000);
    expect(parseTtlMs("7d")).toBe(604_800_000);
    expect(parseTtlMs("2w")).toBe(1_209_600_000);
  });

  it("treats number input as seconds", () => {
    expect(parseTtlMs(60)).toBe(60_000);
  });

  it("throws on invalid string", () => {
    expect(() => parseTtlMs("never")).toThrow(CacheInvalidTtlError);
    expect(() => parseTtlMs("1y")).toThrow(CacheInvalidTtlError);
  });

  it("EC-8: zero is accepted (effectively disables cache for that entry)", () => {
    expect(parseTtlMs("0s")).toBe(0);
    expect(parseTtlMs(0)).toBe(0);
  });

  it("EC-8: negative number throws", () => {
    expect(() => parseTtlMs(-1)).toThrow(CacheInvalidTtlError);
  });

  it("EC-8: Infinity / NaN throws", () => {
    expect(() => parseTtlMs(Number.POSITIVE_INFINITY)).toThrow(CacheInvalidTtlError);
    expect(() => parseTtlMs(Number.NaN)).toThrow(CacheInvalidTtlError);
  });
});
