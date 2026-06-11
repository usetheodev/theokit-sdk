import { describe, expect, it, vi } from "vitest";

import { cosineSimilarity, rememberMany } from "../src/internal/batch-encoder.js";

function makeMockEmbedding(dim = 3) {
  return {
    id: "test",
    providerId: "test",
    model: "test-model",
    dimension: dim,
    embed: vi.fn(async (texts: readonly string[]) =>
      texts.map((t) => {
        const hash = [...t].reduce((acc, c) => acc + c.charCodeAt(0), 0);
        return Array.from({ length: dim }, (_, i) => ((hash + i) % 100) / 100);
      }),
    ),
    stats: () => ({ calls: 0, cacheHits: 0, cacheMisses: 0, totalTokens: 0 }),
  };
}

describe("rememberMany", () => {
  it("embeds all texts in a single API call", async () => {
    const emb = makeMockEmbedding();
    await rememberMany(["a", "b", "c"], emb as never);
    expect(emb.embed).toHaveBeenCalledTimes(1);
    expect(emb.embed).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("deduplicates identical texts", async () => {
    const emb = makeMockEmbedding();
    const { result } = await rememberMany(["hello", "hello", "world"], emb as never);
    expect(result.total).toBe(3);
    expect(result.deduped).toBeGreaterThanOrEqual(1);
    expect(result.inserted).toBeLessThan(3);
  });

  it("preserves dissimilar texts", async () => {
    const emb = {
      ...makeMockEmbedding(),
      embed: vi.fn(async (texts: readonly string[]) =>
        texts.map((_, i) => {
          const v = new Array(3).fill(0);
          v[i % 3] = 1;
          return v;
        }),
      ),
    };
    const { result } = await rememberMany(["a", "b", "c"], emb as never);
    expect(result.inserted).toBe(3);
    expect(result.deduped).toBe(0);
  });

  it("returns empty result for empty input", async () => {
    const emb = makeMockEmbedding();
    const { result } = await rememberMany([], emb as never);
    expect(result).toEqual({ total: 0, deduped: 0, inserted: 0 });
    expect(emb.embed).not.toHaveBeenCalled();
  });

  it("handles single text without dedup", async () => {
    const emb = makeMockEmbedding();
    const { result } = await rememberMany(["only one"], emb as never);
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.deduped).toBe(0);
  });

  it("uses custom dedup threshold", async () => {
    const emb = makeMockEmbedding();
    const { result: strict } = await rememberMany(["a", "b"], emb as never, {
      dedupThreshold: 0.99,
    });
    const { result: loose } = await rememberMany(["a", "b"], emb as never, {
      dedupThreshold: 0.01,
    });
    expect(strict.inserted).toBeGreaterThanOrEqual(loose.inserted);
  });

  it("returns items with text and vector", async () => {
    const emb = makeMockEmbedding();
    const { items } = await rememberMany(["test"], emb as never);
    expect(items[0]!.text).toBe("test");
    expect(items[0]!.vector).toHaveLength(3);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
  });

  it("returns 0 for zero vectors (EC-3 guard)", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
  });
});
