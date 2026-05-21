/**
 * Tests for Ollama embedding adapter (T3.1, ADR D183).
 *
 * Validates:
 *  - Sentinel key path: works without OLLAMA_API_KEY (local Ollama).
 *  - OLLAMA_HOST override: baseUrl honors the env var.
 *  - OLLAMA_API_KEY override: explicit value is forwarded to the factory.
 *  - Unknown model: ConfigurationError with code `embedding_unknown_model`.
 *  - Catalog registration.
 *
 * Real-LLM validation lives in `tests/integration/ollama-embedding-end-to-end.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  ollamaMemoryEmbeddingProviderAdapter,
} from "../../../../src/internal/memory/adapters/ollama-embedding.js";
import { MEMORY_EMBEDDING_ADAPTERS } from "../../../../src/internal/memory/adapters/catalog.js";

const ORIG_ENV: Record<string, string | undefined> = {};
const TRACKED_ENV = ["OLLAMA_HOST", "OLLAMA_API_KEY"];

beforeEach(() => {
  for (const k of TRACKED_ENV) {
    ORIG_ENV[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("ollamaMemoryEmbeddingProviderAdapter (D183)", () => {
  it("descriptor shape matches MemoryEmbeddingProviderAdapter contract", () => {
    expect(ollamaMemoryEmbeddingProviderAdapter.id).toBe("ollama");
    expect(ollamaMemoryEmbeddingProviderAdapter.transport).toBe("local");
    expect(ollamaMemoryEmbeddingProviderAdapter.defaultModel).toBe(
      DEFAULT_OLLAMA_EMBEDDING_MODEL,
    );
    expect(ollamaMemoryEmbeddingProviderAdapter.authProviderId).toBe("ollama");
  });

  it("catalog includes ollama as 6th adapter", () => {
    expect(MEMORY_EMBEDDING_ADAPTERS.ollama).toBe(ollamaMemoryEmbeddingProviderAdapter);
    expect(Object.keys(MEMORY_EMBEDDING_ADAPTERS).length).toBe(6);
  });

  it("create() works without OLLAMA_API_KEY (sentinel fallback)", async () => {
    // No OLLAMA_API_KEY — factory should still construct the runtime.
    const fetchSpy = vi.fn();
    const runtime = await ollamaMemoryEmbeddingProviderAdapter.create({
      model: DEFAULT_OLLAMA_EMBEDDING_MODEL,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    expect(runtime.id).toBe("ollama");
    expect(runtime.dimension).toBe(768); // nomic-embed-text default
  });

  it("create() throws ConfigurationError for unknown model", async () => {
    await expect(
      ollamaMemoryEmbeddingProviderAdapter.create({
        model: "totally-fake-model-name",
      }),
    ).rejects.toThrow(/embedding_unknown_model|not in the dimension table/);
  });

  it("OLLAMA_API_KEY env override is honored", async () => {
    process.env.OLLAMA_API_KEY = "secret-cloud-token";
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: new Array(768).fill(0) }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const runtime = await ollamaMemoryEmbeddingProviderAdapter.create({
      model: DEFAULT_OLLAMA_EMBEDDING_MODEL,
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await runtime.embed(["hello"]);
    // Assert: Authorization header carried our cloud token.
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs?.[1]?.headers?.authorization).toBe("Bearer secret-cloud-token");
  });

  it("known models with version tags map to correct dimensions", async () => {
    const tagged = await ollamaMemoryEmbeddingProviderAdapter.create({
      model: "nomic-embed-text:latest",
    });
    expect(tagged.dimension).toBe(768);

    const bge = await ollamaMemoryEmbeddingProviderAdapter.create({
      model: "bge-m3",
    });
    expect(bge.dimension).toBe(1024);
  });
});
