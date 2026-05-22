/**
 * Tests for InMemoryCacheStore — KV lookup, LRU eviction, semantic search
 * with EC-2 dim/embedder filtering, EC-13 in-place replace.
 */

import { describe, expect, it } from "vitest";

import type { CacheEntry } from "../../src/types/cache.js";
import { InMemoryCacheStore } from "../../src/internal/cache/store.js";

function makeEntry(p: Partial<CacheEntry> & { key: string }): CacheEntry {
  const now = Date.now();
  return {
    namespace: "ns",
    embedderId: "fake",
    modelId: "test",
    prompt: "p",
    response: "r",
    vector: [1, 0, 0, 0],
    createdAt: now,
    expiresAt: now + 60_000,
    accessedAt: now,
    accessCount: 0,
    ...p,
  };
}

describe("InMemoryCacheStore — KV", () => {
  it("kvGet returns undefined for missing key", () => {
    const s = new InMemoryCacheStore(10);
    expect(s.kvGet("nope", Date.now())).toBeUndefined();
  });

  it("kvGet returns entry when present + within TTL", () => {
    const s = new InMemoryCacheStore(10);
    s.set(makeEntry({ key: "k1", response: "ok" }));
    const r = s.kvGet("k1", Date.now());
    expect(r?.response).toBe("ok");
  });

  it("kvGet evicts expired entries and returns undefined", () => {
    const s = new InMemoryCacheStore(10);
    s.set(makeEntry({ key: "k1", expiresAt: Date.now() - 1000 }));
    const r = s.kvGet("k1", Date.now());
    expect(r).toBeUndefined();
  });
});

describe("InMemoryCacheStore — eviction", () => {
  it("LRU evicts oldest when over maxEntries", () => {
    const s = new InMemoryCacheStore(3);
    s.set(makeEntry({ key: "k1" }));
    s.set(makeEntry({ key: "k2" }));
    s.set(makeEntry({ key: "k3" }));
    s.set(makeEntry({ key: "k4" })); // pushes out k1
    expect(s.kvGet("k1", Date.now())).toBeUndefined();
    expect(s.kvGet("k4", Date.now())?.key).toBe("k4");
  });

  it("evictExpired removes only expired entries", () => {
    const s = new InMemoryCacheStore(10);
    const now = Date.now();
    s.set(makeEntry({ key: "fresh", expiresAt: now + 60_000 }));
    s.set(makeEntry({ key: "stale", expiresAt: now - 1000 }));
    const count = s.evictExpired(now);
    expect(count).toBe(1);
    expect(s.kvGet("fresh", now)).toBeDefined();
    expect(s.kvGet("stale", now)).toBeUndefined();
  });
});

describe("InMemoryCacheStore — semanticSearch (EC-2 filter)", () => {
  it("returns top-1 within threshold", () => {
    const s = new InMemoryCacheStore(10);
    s.set(makeEntry({ key: "match", vector: [1, 0, 0, 0] }));
    const r = s.semanticSearch([1, 0, 0, 0], 0.1, "fake", "ns", Date.now());
    expect(r?.entry.key).toBe("match");
    expect(r?.distance).toBeLessThan(0.001);
  });

  it("returns undefined when above threshold", () => {
    const s = new InMemoryCacheStore(10);
    s.set(makeEntry({ key: "orthogonal", vector: [0, 0, 0, 1] }));
    const r = s.semanticSearch([1, 0, 0, 0], 0.5, "fake", "ns", Date.now());
    // distance is ~1.0 (orthogonal), threshold 0.5 → no match
    expect(r).toBeUndefined();
  });

  it("EC-2: skips entries with different embedderId", () => {
    const s = new InMemoryCacheStore(10);
    s.set(makeEntry({ key: "wrong-embedder", embedderId: "other" }));
    const r = s.semanticSearch([1, 0, 0, 0], 0.5, "fake", "ns", Date.now());
    expect(r).toBeUndefined();
  });

  it("EC-2: skips entries with different vector dim", () => {
    const s = new InMemoryCacheStore(10);
    s.set(makeEntry({ key: "wrong-dim", vector: [1, 0] }));
    const r = s.semanticSearch([1, 0, 0, 0], 0.5, "fake", "ns", Date.now());
    expect(r).toBeUndefined();
  });

  it("skips entries from different namespace", () => {
    const s = new InMemoryCacheStore(10);
    s.set(makeEntry({ key: "other-ns", namespace: "tenant-b" }));
    const r = s.semanticSearch([1, 0, 0, 0], 0.5, "fake", "ns", Date.now());
    expect(r).toBeUndefined();
  });

  it("skips expired entries", () => {
    const s = new InMemoryCacheStore(10);
    s.set(makeEntry({ key: "stale", expiresAt: Date.now() - 1000 }));
    const r = s.semanticSearch([1, 0, 0, 0], 0.5, "fake", "ns", Date.now());
    expect(r).toBeUndefined();
  });
});

describe("InMemoryCacheStore — EC-13 in-place replace", () => {
  it("set with existing key replaces (no duplicate)", () => {
    const s = new InMemoryCacheStore(10);
    s.set(makeEntry({ key: "k1", response: "v1" }));
    s.set(makeEntry({ key: "k1", response: "v2" }));
    expect(s.stats().entries).toBe(1);
    expect(s.kvGet("k1", Date.now())?.response).toBe("v2");
  });
});
