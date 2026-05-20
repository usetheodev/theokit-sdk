import { describe, expect, it } from "vitest";

import { AuthenticationError, ConfigurationError } from "../../../src/errors.js";
import { openAiMemoryEmbeddingProviderAdapter } from "../../../src/internal/memory/adapters/openai-embedding.js";

/**
 * Phase 4 T4.2 — OpenAI embedding adapter.
 */

interface StubBody {
  model: string;
  input: string[];
}

function makeFetchStub(responses: Array<{ status: number; body?: unknown }>): {
  fetch: typeof fetch;
  calls: StubBody[];
} {
  const calls: StubBody[] = [];
  let i = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as StubBody;
    calls.push(body);
    const resp = responses[Math.min(i, responses.length - 1)] ?? { status: 200 };
    i += 1;
    return new Response(JSON.stringify(resp.body ?? {}), {
      status: resp.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

function embeddingPayload(n: number, dim = 1536): { data: Array<{ embedding: number[] }> } {
  return {
    data: Array.from({ length: n }, () => ({ embedding: new Array(dim).fill(0.001) })),
  };
}

describe("OpenAI embedding adapter", () => {
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
