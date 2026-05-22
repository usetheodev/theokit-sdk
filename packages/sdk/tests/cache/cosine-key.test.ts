/**
 * Tests for cosineDistance + computeCacheKey.
 */

import { describe, expect, it } from "vitest";

import { cosineDistance } from "../../src/internal/cache/cosine.js";
import { computeCacheKey } from "../../src/internal/cache/key.js";

describe("cosineDistance", () => {
  it("identical vectors → distance 0", () => {
    const d = cosineDistance([1, 0, 0, 0], [1, 0, 0, 0]);
    expect(d).toBeLessThan(0.001);
  });

  it("orthogonal vectors → distance 1", () => {
    const d = cosineDistance([1, 0, 0, 0], [0, 1, 0, 0]);
    expect(d).toBeCloseTo(1.0, 3);
  });

  it("opposite vectors → distance 2", () => {
    const d = cosineDistance([1, 0, 0, 0], [-1, 0, 0, 0]);
    expect(d).toBeCloseTo(2.0, 3);
  });

  it("zero vectors → distance 1 (defensive default)", () => {
    expect(cosineDistance([0, 0, 0, 0], [1, 0, 0, 0])).toBe(1.0);
    expect(cosineDistance([1, 0, 0, 0], [0, 0, 0, 0])).toBe(1.0);
  });

  it("throws on dim mismatch", () => {
    expect(() => cosineDistance([1, 0], [1, 0, 0])).toThrow(/dim mismatch/);
  });
});

describe("computeCacheKey", () => {
  it("is deterministic for same inputs", () => {
    const a = computeCacheKey({ namespace: "n", embedderId: "e", modelId: "m", prompt: "hi" });
    const b = computeCacheKey({ namespace: "n", embedderId: "e", modelId: "m", prompt: "hi" });
    expect(a).toBe(b);
  });

  it("changes when namespace differs", () => {
    const a = computeCacheKey({ namespace: "n1", embedderId: "e", modelId: "m", prompt: "hi" });
    const b = computeCacheKey({ namespace: "n2", embedderId: "e", modelId: "m", prompt: "hi" });
    expect(a).not.toBe(b);
  });

  it("changes when embedderId differs (D258)", () => {
    const a = computeCacheKey({ namespace: "n", embedderId: "e1", modelId: "m", prompt: "hi" });
    const b = computeCacheKey({ namespace: "n", embedderId: "e2", modelId: "m", prompt: "hi" });
    expect(a).not.toBe(b);
  });

  it("changes when modelId differs", () => {
    const a = computeCacheKey({ namespace: "n", embedderId: "e", modelId: "m1", prompt: "hi" });
    const b = computeCacheKey({ namespace: "n", embedderId: "e", modelId: "m2", prompt: "hi" });
    expect(a).not.toBe(b);
  });

  it("normalizes whitespace + case", () => {
    const a = computeCacheKey({ namespace: "n", embedderId: "e", modelId: "m", prompt: "  Hello  WORLD  " });
    const b = computeCacheKey({ namespace: "n", embedderId: "e", modelId: "m", prompt: "hello world" });
    expect(a).toBe(b);
  });
});
