import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuthenticationError, ConfigurationError } from "../../../src/errors.js";
import { openAiMemoryEmbeddingProviderAdapter } from "../../../src/internal/memory/adapters/openai-embedding.js";
import { __TESTING__resetGlobalEmbeddingCache } from "../../../src/internal/memory/embedding-cache.js";

/**
 * Phase 4 T4.2 — OpenAI embedding adapter.
 */

interface StubBody {
  model: string;
  input: string[];
}

function makeFetchStub(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
): {
  fetch: typeof fetch;
  calls: StubBody[];
  /** Wall-clock ms of each call, relative to the first. Lets a test SEE the backoff. */
  callTimes: number[];
} {
  const calls: StubBody[] = [];
  const callTimes: number[] = [];
  const t0 = Date.now();
  let i = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as StubBody;
    calls.push(body);
    callTimes.push(Date.now() - t0);
    const resp = responses[Math.min(i, responses.length - 1)] ?? { status: 200 };
    i += 1;
    return new Response(JSON.stringify(resp.body ?? {}), {
      status: resp.status,
      headers: { "content-type": "application/json", ...resp.headers },
    });
  };
  return { fetch: fetchImpl, calls, callTimes };
}

function embeddingPayload(n: number, dim = 1536): { data: Array<{ embedding: number[] }> } {
  return {
    data: Array.from({ length: n }, () => ({ embedding: new Array(dim).fill(0.001) })),
  };
}

describe("OpenAI embedding adapter", () => {
  beforeEach(() => {
    __TESTING__resetGlobalEmbeddingCache();
  });
  afterEach(() => {
    __TESTING__resetGlobalEmbeddingCache();
  });

  it("embeds a single text via /v1/embeddings", async () => {
    const stub = makeFetchStub([{ status: 200, body: embeddingPayload(1) }]);
    const runtime = await openAiMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-stub",
      fetch: stub.fetch,
    });
    const vectors = await runtime.embed(["hello"]);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(runtime.dimension);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.input).toEqual(["hello"]);
  });

  it("batches 250 texts into 3 HTTP calls (100/100/50)", async () => {
    const stub = makeFetchStub([
      { status: 200, body: embeddingPayload(100) },
      { status: 200, body: embeddingPayload(100) },
      { status: 200, body: embeddingPayload(50) },
    ]);
    const runtime = await openAiMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-stub",
      fetch: stub.fetch,
    });
    const texts = Array.from({ length: 250 }, (_, i) => `text-${i}`);
    const vectors = await runtime.embed(texts);
    expect(vectors).toHaveLength(250);
    expect(stub.calls).toHaveLength(3);
    expect(stub.calls[0]?.input).toHaveLength(100);
    expect(stub.calls[1]?.input).toHaveLength(100);
    expect(stub.calls[2]?.input).toHaveLength(50);
  });

  it("caches repeated texts (same text twice → 1 HTTP call)", async () => {
    const stub = makeFetchStub([{ status: 200, body: embeddingPayload(1) }]);
    const runtime = await openAiMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-stub",
      fetch: stub.fetch,
    });
    await runtime.embed(["repeat me"]);
    await runtime.embed(["repeat me"]);
    expect(stub.calls).toHaveLength(1);
    const stats = runtime.stats();
    expect(stats.cacheHits).toBe(1);
    expect(stats.cacheMisses).toBe(1);
  });

  it("throws AuthenticationError on 401", async () => {
    const stub = makeFetchStub([{ status: 401, body: { error: "unauthorized" } }]);
    const runtime = await openAiMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-bad",
      fetch: stub.fetch,
    });
    await expect(runtime.embed(["any"])).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("retries on 429 with backoff then succeeds", async () => {
    const stub = makeFetchStub([{ status: 429 }, { status: 200, body: embeddingPayload(1) }]);
    const runtime = await openAiMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-stub",
      fetch: stub.fetch,
    });
    const vectors = await runtime.embed(["retry"]);
    expect(vectors).toHaveLength(1);
    expect(stub.calls).toHaveLength(2);
    expect(runtime.stats().retries).toBe(1);
  });

  it("waits at least the backoff floor before retrying a 429 that sent Retry-After", async () => {
    // The two tests above say "with backoff" and never observe one: they pass identically against a
    // 0ms sleep. This one is the oracle for WHICH backoff.
    //
    // The adapter used to answer "how do we retry an HTTP call to a model provider" by hand —
    // `50 * attempt`, linear, no Retry-After, no cap — while the SDK already answered it in
    // `internal/llm/retry.ts` (full jitter per Brooker 2015). It now shares that answer, tuned
    // tighter for this layer: base 250ms, cap 4s, because an embedding retry sits inside a memory
    // write on the agent's critical path and carries no abort signal.
    //
    // `Retry-After: 0` is what makes this deterministic — the provider's hint wins, clamped up to
    // the base — so the assertion is a fixed floor rather than a jitter range. Against the old
    // linear code the first retry slept 50ms and this fails.
    const stub = makeFetchStub([
      { status: 429, headers: { "retry-after": "0" } },
      { status: 200, body: embeddingPayload(1) },
    ]);
    const runtime = await openAiMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-stub",
      fetch: stub.fetch,
    });
    await runtime.embed(["retry-after"]);

    expect(stub.calls).toHaveLength(2);
    const waited = (stub.callTimes[1] ?? 0) - (stub.callTimes[0] ?? 0);
    expect(waited, `retry waited ${waited}ms; the floor is 250ms`).toBeGreaterThanOrEqual(200);
  });

  it("retries on 5xx with backoff then succeeds (EC-9)", async () => {
    const stub = makeFetchStub([{ status: 503 }, { status: 200, body: embeddingPayload(1) }]);
    const runtime = await openAiMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-stub",
      fetch: stub.fetch,
    });
    const vectors = await runtime.embed(["retry"]);
    expect(vectors).toHaveLength(1);
    expect(stub.calls).toHaveLength(2);
    expect(runtime.stats().retries).toBe(1);
  });

  it("propagates ConfigurationError on non-retryable 400 (post-D67 mapper)", async () => {
    const stub = makeFetchStub([{ status: 400, body: { error: "bad request" } }]);
    const runtime = await openAiMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-stub",
      fetch: stub.fetch,
    });
    await expect(runtime.embed(["x"])).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("throws AuthenticationError when OPENAI_API_KEY is missing entirely", async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(
        openAiMemoryEmbeddingProviderAdapter.create({
          fetch: makeFetchStub([]).fetch,
        }),
      ).rejects.toBeInstanceOf(AuthenticationError);
    } finally {
      if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    }
  });
});
