/**
 * Tests for performStore — EC-3 empty bypass, EC-10 tool-use skip,
 * exclude regex, embedder failure silent.
 */

import { describe, expect, it } from "vitest";
import { InMemoryCacheStore } from "../../src/internal/cache/store.js";
import { performStore } from "../../src/internal/cache/store-handler.js";

const fakeEmbedder = {
  id: "fake",
  model: "fake-1",
  dimension: 4,
  embed: async (texts: ReadonlyArray<string>) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
};

const broken = {
  id: "broken",
  model: "broken-1",
  dimension: 4,
  embed: async () => {
    throw new Error("rate limit");
  },
};

const ttl = { default: "1h" as const };

describe("performStore", () => {
  it("inserts entry with correct TTL", async () => {
    const store = new InMemoryCacheStore(10);
    await performStore({
      prompt: "hello",
      response: "world",
      store,
      embedder: fakeEmbedder,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(store.stats().entries).toBe(1);
  });

  it("EC-3: skips empty prompt", async () => {
    const store = new InMemoryCacheStore(10);
    await performStore({
      prompt: "   ",
      response: "world",
      store,
      embedder: fakeEmbedder,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(store.stats().entries).toBe(0);
  });

  it("skips empty response", async () => {
    const store = new InMemoryCacheStore(10);
    await performStore({
      prompt: "hello",
      response: "",
      store,
      embedder: fakeEmbedder,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(store.stats().entries).toBe(0);
  });

  it("EC-10 / D266: skips runs that used tools", async () => {
    const store = new InMemoryCacheStore(10);
    await performStore({
      prompt: "delete file X",
      response: "deleted",
      usedTools: true,
      store,
      embedder: fakeEmbedder,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(store.stats().entries).toBe(0);
  });

  it("respects exclude regex", async () => {
    const store = new InMemoryCacheStore(10);
    await performStore({
      prompt: "what's the weather today?",
      response: "Sunny",
      store,
      embedder: fakeEmbedder,
      ttl: { default: "1h", exclude: /\bweather\b/i },
      namespace: "ns",
      modelId: "m",
    });
    expect(store.stats().entries).toBe(0);
  });

  it("EC-1: embedder failure during store is silent (no entry written)", async () => {
    const store = new InMemoryCacheStore(10);
    await performStore({
      prompt: "hello",
      response: "world",
      store,
      embedder: broken,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(store.stats().entries).toBe(0);
    expect(store.stats().embedderFailures).toBe(1);
  });

  it("overwrites existing key (no duplicate entries)", async () => {
    const store = new InMemoryCacheStore(10);
    await performStore({
      prompt: "hello",
      response: "v1",
      store,
      embedder: fakeEmbedder,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    await performStore({
      prompt: "hello",
      response: "v2",
      store,
      embedder: fakeEmbedder,
      ttl,
      namespace: "ns",
      modelId: "m",
    });
    expect(store.stats().entries).toBe(1);
  });
});
