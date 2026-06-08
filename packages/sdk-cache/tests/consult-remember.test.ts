/**
 * End-to-end tests for `Cache.consult` + `.remember` round-trip.
 * Validates KV hit, semantic hit, miss, EC-10 tool-use skip.
 */

import { describe, expect, it } from "vitest";
import { Cache } from "../src/cache.js";

// Embedder where the resulting vector has 1.0 in position [charCode % 4]
// of the first letter — so paraphrases starting with the same letter
// produce identical vectors.
const letterEmbedder = {
  id: "letter",
  model: "letter-1",
  dimension: 4,
  embed: async (texts: ReadonlyArray<string>) =>
    texts.map((t) => {
      const c = (t.trim().toLowerCase().charCodeAt(0) ?? 0) % 4;
      const v = [0, 0, 0, 0];
      v[c] = 1;
      return v;
    }),
};

describe("Cache.consult / .remember (E2E)", () => {
  it("miss → remember → kv hit", async () => {
    const cache = Cache.semantic({ embedder: letterEmbedder, namespace: "ut-1" });

    const m1 = await cache.consult("hello");
    expect(m1.hit).toBe(false);

    await cache.remember("hello", "world");

    const m2 = await cache.consult("hello");
    expect(m2.hit).toBe(true);
    if (m2.hit) {
      expect(m2.response).toBe("world");
      expect(m2.source).toBe("kv");
    }
    expect(cache.stats().kvHits).toBe(1);
    expect(cache.stats().misses).toBe(1);
  });

  it("paraphrase triggers semantic hit (same first letter → same vector)", async () => {
    const cache = Cache.semantic({ embedder: letterEmbedder, threshold: 0.1, namespace: "ut-2" });
    await cache.remember("hello world", "greeting");
    const m = await cache.consult("hi there"); // first letter 'h' → same vector as 'h' from hello
    expect(m.hit).toBe(true);
    if (m.hit) {
      expect(m.source).toBe("semantic");
      expect(m.response).toBe("greeting");
    }
    expect(cache.stats().semanticHits).toBe(1);
  });

  it("EC-10: remember with usedTools:true does NOT store", async () => {
    const cache = Cache.semantic({ embedder: letterEmbedder, namespace: "ut-3" });
    await cache.remember("delete file x", "deleted", { usedTools: true });
    expect(cache.stats().entries).toBe(0);
    const m = await cache.consult("delete file x");
    expect(m.hit).toBe(false);
  });

  it("clear empties the cache", async () => {
    const cache = Cache.semantic({ embedder: letterEmbedder, namespace: "ut-4" });
    await cache.remember("hello", "world");
    expect(cache.stats().entries).toBe(1);
    await cache.clear();
    expect(cache.stats().entries).toBe(0);
  });

  it("EC-12: threshold 0 still allows KV exact hit", async () => {
    const cache = Cache.semantic({ embedder: letterEmbedder, threshold: 0, namespace: "ut-5" });
    await cache.remember("hello", "world");
    const m = await cache.consult("hello");
    expect(m.hit).toBe(true);
    if (m.hit) expect(m.source).toBe("kv");
  });
});
