/**
 * sdk-memory embedding-adapter cluster smoke test (iter 74).
 *
 * Validates the iter 74 hybrid copies of the 6 provider-specific
 * adapters + adapter-catalog. Pins the canonical metadata each
 * adapter advertises (id, defaultModel, transport, authProviderId,
 * autoSelectPriority) so cross-package consumers see byte-equivalent
 * shape between sdk-core and sdk-memory.
 *
 * Provider runtime behavior is exercised by iter 73's openai-compatible
 * test; this smoke test ONLY verifies adapter metadata + catalog
 * registration so we don't double-cover the HTTP roundtrip math.
 */

import {
  azureOpenAiMemoryEmbeddingProviderAdapter,
  cohereMemoryEmbeddingProviderAdapter,
  DEFAULT_AZURE_OPENAI_EMBEDDING_MODEL,
  DEFAULT_COHERE_EMBEDDING_MODEL,
  DEFAULT_DEEPINFRA_EMBEDDING_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_JINA_EMBEDDING_MODEL,
  DEFAULT_MISTRAL_EMBEDDING_MODEL,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_VOYAGE_EMBEDDING_MODEL,
  deepinfraMemoryEmbeddingProviderAdapter,
  geminiMemoryEmbeddingProviderAdapter,
  jinaMemoryEmbeddingProviderAdapter,
  MEMORY_EMBEDDING_ADAPTERS,
  mistralMemoryEmbeddingProviderAdapter,
  ollamaMemoryEmbeddingProviderAdapter,
  openAiMemoryEmbeddingProviderAdapter,
  openRouterMemoryEmbeddingProviderAdapter,
  voyageMemoryEmbeddingProviderAdapter,
} from "@theokit/sdk-memory";
import { describe, expect, it } from "vitest";

describe("sdk-memory embedding-adapter cluster (iter 74)", () => {
  describe("default model constants", () => {
    it("test_openai_default_model_pinned", () => {
      expect(DEFAULT_OPENAI_EMBEDDING_MODEL).toBe("text-embedding-3-small");
    });
    it("test_mistral_default_model_pinned", () => {
      expect(DEFAULT_MISTRAL_EMBEDDING_MODEL).toBe("mistral-embed");
    });
    it("test_deepinfra_default_model_pinned", () => {
      expect(DEFAULT_DEEPINFRA_EMBEDDING_MODEL).toBe("BAAI/bge-large-en-v1.5");
    });
    it("test_voyage_default_model_pinned", () => {
      expect(DEFAULT_VOYAGE_EMBEDDING_MODEL).toBe("voyage-3-lite");
    });
    it("test_openrouter_default_model_pinned", () => {
      expect(DEFAULT_OPENROUTER_EMBEDDING_MODEL).toBe("openai/text-embedding-3-small");
    });
    it("test_ollama_default_model_pinned", () => {
      expect(DEFAULT_OLLAMA_EMBEDDING_MODEL).toBe("nomic-embed-text");
    });
  });

  describe("per-provider adapter metadata", () => {
    it("test_openai_adapter_shape", () => {
      expect(openAiMemoryEmbeddingProviderAdapter.id).toBe("openai");
      expect(openAiMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(openAiMemoryEmbeddingProviderAdapter.authProviderId).toBe("openai");
      expect(openAiMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(20);
    });
    it("test_mistral_adapter_shape", () => {
      expect(mistralMemoryEmbeddingProviderAdapter.id).toBe("mistral");
      expect(mistralMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(mistralMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(18);
    });
    it("test_deepinfra_adapter_shape", () => {
      expect(deepinfraMemoryEmbeddingProviderAdapter.id).toBe("deepinfra");
      expect(deepinfraMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(deepinfraMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(13);
    });
    it("test_voyage_adapter_shape", () => {
      expect(voyageMemoryEmbeddingProviderAdapter.id).toBe("voyage");
      expect(voyageMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(voyageMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(14);
    });
    it("test_openrouter_adapter_shape", () => {
      expect(openRouterMemoryEmbeddingProviderAdapter.id).toBe("openrouter");
      expect(openRouterMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(openRouterMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(15);
    });
    it("test_ollama_adapter_is_only_local_transport", () => {
      expect(ollamaMemoryEmbeddingProviderAdapter.id).toBe("ollama");
      // The single transport: "local" adapter in the cluster.
      expect(ollamaMemoryEmbeddingProviderAdapter.transport).toBe("local");
      expect(ollamaMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(10);
    });
  });

  // theokit#128 — the four adapters sdk-core added in T4.10 and this package drifted behind for
  // two months. Same metadata as core's, because the peer's catalog REPLACES core's at runtime:
  // any divergence here is a divergence a consumer sees.
  describe("per-provider adapter metadata (theokit#128 parity additions)", () => {
    it("test_azure_openai_adapter_shape", () => {
      expect(azureOpenAiMemoryEmbeddingProviderAdapter.id).toBe("azure-openai");
      expect(azureOpenAiMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(azureOpenAiMemoryEmbeddingProviderAdapter.authProviderId).toBe("azure-openai");
      expect(azureOpenAiMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(25);
      expect(DEFAULT_AZURE_OPENAI_EMBEDDING_MODEL).toBe("text-embedding-3-small");
    });
    it("test_cohere_adapter_shape", () => {
      expect(cohereMemoryEmbeddingProviderAdapter.id).toBe("cohere");
      expect(cohereMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(cohereMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(30);
      expect(DEFAULT_COHERE_EMBEDDING_MODEL).toBe("embed-english-v3.0");
    });
    it("test_jina_adapter_shape", () => {
      expect(jinaMemoryEmbeddingProviderAdapter.id).toBe("jina");
      expect(jinaMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(jinaMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(35);
      expect(DEFAULT_JINA_EMBEDDING_MODEL).toBe("jina-embeddings-v3");
    });
    it("test_gemini_adapter_shape", () => {
      expect(geminiMemoryEmbeddingProviderAdapter.id).toBe("gemini");
      expect(geminiMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(geminiMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(30);
      expect(DEFAULT_GEMINI_EMBEDDING_MODEL).toBe("text-embedding-004");
    });
  });

  describe("MEMORY_EMBEDDING_ADAPTERS catalog", () => {
    it("test_catalog_contains_the_canonical_10_provider_ids", () => {
      // theokit#128: was 6. The peer must serve everything core advertises — see the catalog
      // docblock and the cross-package gate in @theokit/sdk-peer-integration-tests.
      const ids = Object.keys(MEMORY_EMBEDDING_ADAPTERS).sort();
      expect(ids).toEqual([
        "azure-openai",
        "cohere",
        "deepinfra",
        "gemini",
        "jina",
        "mistral",
        "ollama",
        "openai",
        "openrouter",
        "voyage",
      ]);
    });

    it("test_catalog_indexes_by_provider_id_matching_adapter_id", () => {
      for (const [key, adapter] of Object.entries(MEMORY_EMBEDDING_ADAPTERS)) {
        expect(adapter.id).toBe(key);
      }
    });

    it("test_catalog_excludes_deferred_v11_providers", () => {
      // ADR D183 (Iter 45 catalog source): lmstudio / google / bedrock
      // are deferred to v1.1. The v1.0 catalog MUST NOT include them.
      expect("lmstudio" in MEMORY_EMBEDDING_ADAPTERS).toBe(false);
      expect("google" in MEMORY_EMBEDDING_ADAPTERS).toBe(false);
      expect("bedrock" in MEMORY_EMBEDDING_ADAPTERS).toBe(false);
    });
  });
});
