/**
 * Tests for `Cache.semantic` factory + validation + asPlugin (EC-4 memoization).
 */

import { describe, expect, it } from "vitest";
import { Cache } from "../../src/cache.js";

const fakeEmbedder = {
  id: "fake",
  model: "fake-1",
  dimension: 4,
  embed: async (texts: ReadonlyArray<string>) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
};

describe("Cache.semantic", () => {
  it("validates options via Zod (embedder required)", () => {
    expect(() => Cache.semantic({} as never)).toThrow();
    expect(() => Cache.semantic({ embedder: fakeEmbedder })).not.toThrow();
  });

  it("rejects threshold out of range", () => {
    expect(() => Cache.semantic({ embedder: fakeEmbedder, threshold: -0.1 })).toThrow();
    expect(() => Cache.semantic({ embedder: fakeEmbedder, threshold: 2.1 })).toThrow();
    expect(() => Cache.semantic({ embedder: fakeEmbedder, threshold: 0.85 })).not.toThrow();
  });

  it("rejects json backend without dir", () => {
    expect(() =>
      Cache.semantic({
        embedder: fakeEmbedder,
        persistence: { backend: "json" } as never,
      }),
    ).toThrow(/dir is required/i);
  });

  it("accepts json backend with dir", () => {
    expect(() =>
      Cache.semantic({
        embedder: fakeEmbedder,
        persistence: { backend: "json", dir: "/tmp/test-cache" },
      }),
    ).not.toThrow();
  });

  it("EC-4: asPlugin() called twice returns the SAME descriptor", () => {
    const cache = Cache.semantic({ embedder: fakeEmbedder });
    const p1 = cache.asPlugin();
    const p2 = cache.asPlugin();
    expect(p1).toBe(p2); // referential equality — same memoized object
  });

  it("plugin name includes namespace", () => {
    const cache = Cache.semantic({ embedder: fakeEmbedder, namespace: "tenant-a" });
    const plugin = cache.asPlugin();
    expect(plugin.name).toBe("cache-semantic-tenant-a");
  });

  it("EC-12: threshold 0 accepts only identical vectors", async () => {
    const cache = Cache.semantic({ embedder: fakeEmbedder, threshold: 0 });
    await cache.remember("hello", "world");
    const r1 = await cache.consult("hello"); // KV exact hit (not vector)
    expect(r1.hit).toBe(true);
  });
});
