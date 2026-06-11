/**
 * Tests for performLookup — kv hit, semantic hit, exclude regex,
 * EC-1 embedder failure degradation, EC-3 empty prompt bypass.
 */

import { describe, expect, it } from "vitest";
import { computeCacheKey } from "../src/internal/key.js";
import { performLookup } from "../src/internal/lookup.js";
import { InMemoryCacheStore } from "../src/internal/store.js";

const fakeEmbedder = {
  id: "fake",
  model: "fake-1",
  dimension: 4,
  embed: async (texts: ReadonlyArray<string>) =>
    texts.map((t) => {
      // Deterministic: first char ascii → vector
      const c = t.charCodeAt(0) || 0;
      return [c / 255, 0.1, 0.2, 0.3] as number[];
    }),
};

const broken = {
  id: "broken",
  model: "broken-1",
  dimension: 4,
  embed: async () => {
    throw new Error("network down");
  },
};

const ttl = { default: "1h" as const };

describe("performLookup", () => {
  it("returns cached on KV exact hit", async () => {
    const store = new InMemoryCacheStore(10);
    const now = Date.now();
    const key = computeCacheKey({
      namespace: "ns",
      embedderId: "fake",
      modelId: "m",
      prompt: "hello",
    });
    store.set({
      key,
      namespace: "ns",
      embedderId: "fake",
      modelId: "m",
      prompt: "hello",
      response: "cached-kv",
      vector: [1, 0, 0, 0],
      createdAt: now,
      expiresAt: now + 60_000,
      accessedAt: now,
      accessCount: 0,
    });

    const r = await performLookup({
      prompt: "hello",
      store,
      embedder: fakeEmbedder,
      threshold: 0.5,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(r.cached).toBe(true);
    expect(r.response).toBe("cached-kv");
    expect(r.source).toBe("kv");
  });

  it("falls through to semantic when KV misses", async () => {
    const store = new InMemoryCacheStore(10);
    const now = Date.now();
    store.set({
      key: "different-key",
      namespace: "ns",
      embedderId: "fake",
      modelId: "m",
      prompt: "earlier",
      response: "cached-semantic",
      // vector that fakeEmbedder('h') would produce (104/255)
      vector: [104 / 255, 0.1, 0.2, 0.3],
      createdAt: now,
      expiresAt: now + 60_000,
      accessedAt: now,
      accessCount: 0,
    });

    const r = await performLookup({
      prompt: "hello", // first char 'h' = 104; matches the stored vector
      store,
      embedder: fakeEmbedder,
      threshold: 0.5,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(r.cached).toBe(true);
    expect(r.source).toBe("semantic");
  });

  it("returns miss when no entry matches", async () => {
    const store = new InMemoryCacheStore(10);
    const r = await performLookup({
      prompt: "totally-unique",
      store,
      embedder: fakeEmbedder,
      threshold: 0.001,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(r.cached).toBe(false);
  });

  it("EC-3: empty prompt bypasses cache (returns miss)", async () => {
    const store = new InMemoryCacheStore(10);
    const r = await performLookup({
      prompt: "   ",
      store,
      embedder: fakeEmbedder,
      threshold: 0.5,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(r.cached).toBe(false);
    expect(store.stats().misses).toBe(1);
  });

  it("exclusion regex skips lookup + increments excluded counter", async () => {
    const store = new InMemoryCacheStore(10);
    const r = await performLookup({
      prompt: "what is the weather today?",
      store,
      embedder: fakeEmbedder,
      threshold: 0.5,
      ttl: { default: "1h", exclude: /\b(weather|today|now)\b/i },
      namespace: "ns",
      modelId: "m",
    });
    expect(r.cached).toBe(false);
    expect(store.stats().excluded).toBe(1);
  });

  it("EC-1: embedder failure degrades to miss (not throw)", async () => {
    const store = new InMemoryCacheStore(10);
    const r = await performLookup({
      prompt: "anything",
      store,
      embedder: broken,
      threshold: 0.5,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(r.cached).toBe(false);
    expect(store.stats().embedderFailures).toBe(1);
  });
});
