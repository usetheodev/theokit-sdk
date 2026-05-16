import { describe, expect, it } from "vitest";

import { MEMORY_EMBEDDING_ADAPTERS } from "../../../src/internal/memory/adapters/catalog.js";
import { mistralMemoryEmbeddingProviderAdapter } from "../../../src/internal/memory/adapters/mistral-embedding.js";
import { openRouterMemoryEmbeddingProviderAdapter } from "../../../src/internal/memory/adapters/openrouter-embedding.js";

/**
 * Memory embedding adapter catalog — only adapters that ship a real
 * implementation are exposed. Throwing stub adapters are forbidden by the
 * project's "no stubs, no mocks, no unwired code" rule.
 */

function stubFetch(responses: Array<{ status: number; body?: unknown }>): {
  fetch: typeof fetch;
  calls: number;
} {
  let i = 0;
  const state = { calls: 0 };
  const fetchImpl: typeof fetch = async () => {
    state.calls += 1;
    const resp = responses[Math.min(i, responses.length - 1)] ?? { status: 200 };
    i += 1;
    return new Response(JSON.stringify(resp.body ?? {}), {
      status: resp.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls: state.calls };
}

describe("MEMORY_EMBEDDING_ADAPTERS catalog", () => {
  it("exposes only fully-implemented providers (openai + mistral + openrouter)", () => {
    const ids = Object.keys(MEMORY_EMBEDDING_ADAPTERS).sort();
    expect(ids).toEqual(["mistral", "openai", "openrouter"]);
    for (const [id, adapter] of Object.entries(MEMORY_EMBEDDING_ADAPTERS)) {
      expect(adapter.id).toBe(id);
      expect(typeof adapter.defaultModel).toBe("string");
      expect(adapter.defaultModel.length).toBeGreaterThan(0);
      expect(["local", "remote"]).toContain(adapter.transport);
    }
  });

  it("does NOT expose stub providers (voyage, deepinfra, lmstudio, google, bedrock)", () => {
    for (const id of ["voyage", "deepinfra", "lmstudio", "google", "bedrock"]) {
      expect(MEMORY_EMBEDDING_ADAPTERS[id]).toBeUndefined();
    }
  });

  it("openrouter adapter actually embeds via stubbed /api/v1/embeddings", async () => {
    const stub = stubFetch([
      {
        status: 200,
        body: { data: [{ embedding: new Array(1536).fill(0.01) }] },
      },
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
      {
        status: 200,
        body: { data: [{ embedding: new Array(1024).fill(0.01) }] },
      },
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
});
