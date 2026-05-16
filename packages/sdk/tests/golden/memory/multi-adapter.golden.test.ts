import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { MEMORY_EMBEDDING_ADAPTERS } from "../../../src/internal/memory/adapters/catalog.js";
import { deepinfraMemoryEmbeddingProviderAdapter } from "../../../src/internal/memory/adapters/deepinfra-embedding.js";
import { mistralMemoryEmbeddingProviderAdapter } from "../../../src/internal/memory/adapters/mistral-embedding.js";
import { openAiMemoryEmbeddingProviderAdapter } from "../../../src/internal/memory/adapters/openai-embedding.js";
import { openRouterMemoryEmbeddingProviderAdapter } from "../../../src/internal/memory/adapters/openrouter-embedding.js";
import { voyageMemoryEmbeddingProviderAdapter } from "../../../src/internal/memory/adapters/voyage-embedding.js";

/**
 * Memory embedding adapter catalog — only adapters that ship a real
 * implementation are exposed. Throwing stub adapters are forbidden by the
 * project's "no stubs, no mocks, no unwired code" rule.
 *
 * Locked by ADR D11: openai, mistral, openrouter, voyage, deepinfra.
 */

interface StubCall {
  url: string;
  body: unknown;
}

function stubFetch(responses: Array<{ status: number; body?: unknown }>): {
  fetch: typeof fetch;
  calls: StubCall[];
} {
  let i = 0;
  const calls: StubCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const body = init?.body !== undefined ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, body });
    const resp = responses[Math.min(i, responses.length - 1)] ?? { status: 200 };
    i += 1;
    return new Response(JSON.stringify(resp.body ?? {}), {
      status: resp.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

describe("MEMORY_EMBEDDING_ADAPTERS catalog", () => {
  it("exposes the 5 v1.0 providers (openai + mistral + openrouter + voyage + deepinfra) per ADR D11", () => {
    const ids = Object.keys(MEMORY_EMBEDDING_ADAPTERS).sort();
    expect(ids).toEqual(["deepinfra", "mistral", "openai", "openrouter", "voyage"]);
    for (const [id, adapter] of Object.entries(MEMORY_EMBEDDING_ADAPTERS)) {
      expect(adapter.id).toBe(id);
      expect(typeof adapter.defaultModel).toBe("string");
      expect(adapter.defaultModel.length).toBeGreaterThan(0);
      expect(["local", "remote"]).toContain(adapter.transport);
    }
  });

  it("does NOT expose v1.1-deferred providers (lmstudio, google, bedrock)", () => {
    for (const id of ["lmstudio", "google", "bedrock"]) {
      expect(MEMORY_EMBEDDING_ADAPTERS[id]).toBeUndefined();
    }
  });

  it("openrouter adapter actually embeds via stubbed /api/v1/embeddings", async () => {
    const stub = stubFetch([
      { status: 200, body: { data: [{ embedding: new Array(1536).fill(0.01) }] } },
    ]);
    const runtime = await openRouterMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-or-stub",
      fetch: stub.fetch,
    });
    const vectors = await runtime.embed(["hello"]);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]?.length).toBe(1536);
    expect(runtime.id).toBe("openrouter");
    expect(runtime.model).toBe("openai/text-embedding-3-small");
  });

  it("mistral adapter actually embeds via stubbed /v1/embeddings", async () => {
    const stub = stubFetch([
      { status: 200, body: { data: [{ embedding: new Array(1024).fill(0.01) }] } },
    ]);
    const runtime = await mistralMemoryEmbeddingProviderAdapter.create({
      apiKey: "sk-mistral-stub",
      fetch: stub.fetch,
    });
    const vectors = await runtime.embed(["hello"]);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]?.length).toBe(1024);
    expect(runtime.id).toBe("mistral");
    expect(runtime.model).toBe("mistral-embed");
  });

  it("voyage adapter embeds via stubbed /v1/embeddings", async () => {
    const stub = stubFetch([
      { status: 200, body: { data: [{ embedding: new Array(512).fill(0.01) }] } },
    ]);
    const runtime = await voyageMemoryEmbeddingProviderAdapter.create({
      apiKey: "vy-stub",
      fetch: stub.fetch,
    });
    const vectors = await runtime.embed(["hello"]);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]?.length).toBe(512);
    expect(runtime.id).toBe("voyage");
    expect(runtime.model).toBe("voyage-3-lite");
    expect(stub.calls[0]?.url).toBe("https://api.voyageai.com/v1/embeddings");
  });

  it("voyage honors VOYAGE_API_KEY env when options.apiKey omitted", async () => {
    const oldEnv = process.env.VOYAGE_API_KEY;
    process.env.VOYAGE_API_KEY = "vy-from-env";
    try {
      const stub = stubFetch([
        { status: 200, body: { data: [{ embedding: new Array(512).fill(0.0) }] } },
      ]);
      const runtime = await voyageMemoryEmbeddingProviderAdapter.create({ fetch: stub.fetch });
      await runtime.embed(["x"]);
      expect(stub.calls[0]?.url).toBe("https://api.voyageai.com/v1/embeddings");
    } finally {
      if (oldEnv === undefined) delete process.env.VOYAGE_API_KEY;
      else process.env.VOYAGE_API_KEY = oldEnv;
    }
  });

  it("deepinfra adapter hits exact URL https://api.deepinfra.com/v1/openai/embeddings (EC-2)", async () => {
    const stub = stubFetch([
      { status: 200, body: { data: [{ embedding: new Array(1024).fill(0.01) }] } },
    ]);
    const runtime = await deepinfraMemoryEmbeddingProviderAdapter.create({
      apiKey: "di-stub",
      fetch: stub.fetch,
    });
    const vectors = await runtime.embed(["hello"]);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]?.length).toBe(1024);
    expect(runtime.id).toBe("deepinfra");
    expect(runtime.model).toBe("BAAI/bge-large-en-v1.5");
    // EC-2: embeddingsPath REPLACES the suffix; URL must NOT be "/v1/openai/v1/embeddings"
    expect(stub.calls[0]?.url).toBe("https://api.deepinfra.com/v1/openai/embeddings");
  });

  it("openai/mistral/openrouter/voyage all hit default /v1/embeddings — no path regression (EC-2)", async () => {
    const cases: Array<
      [Awaited<ReturnType<typeof openAiMemoryEmbeddingProviderAdapter.create>>, string, number]
    > = [];
    for (const [adapter, expectedHost, expectedDim] of [
      [openAiMemoryEmbeddingProviderAdapter, "https://api.openai.com", 1536],
      [mistralMemoryEmbeddingProviderAdapter, "https://api.mistral.ai", 1024],
      [openRouterMemoryEmbeddingProviderAdapter, "https://openrouter.ai/api", 1536],
      [voyageMemoryEmbeddingProviderAdapter, "https://api.voyageai.com", 512],
    ] as const) {
      const stub = stubFetch([
        { status: 200, body: { data: [{ embedding: new Array(expectedDim).fill(0) }] } },
      ]);
      const runtime = await adapter.create({ apiKey: "test", fetch: stub.fetch });
      await runtime.embed(["x"]);
      expect(stub.calls[0]?.url).toBe(`${expectedHost}/v1/embeddings`);
      cases.push([runtime, expectedHost, expectedDim]);
    }
    expect(cases).toHaveLength(4);
  });

  it("rejects unknown model id with embedding_unknown_model (EC-4)", async () => {
    await expect(
      voyageMemoryEmbeddingProviderAdapter.create({
        apiKey: "test",
        model: "voyage-some-future-model",
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    await expect(
      voyageMemoryEmbeddingProviderAdapter.create({
        apiKey: "test",
        model: "voyage-some-future-model",
      }),
    ).rejects.toMatchObject({ code: "embedding_unknown_model" });
  });
});
