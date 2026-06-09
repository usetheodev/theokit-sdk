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
  DEFAULT_DEEPINFRA_EMBEDDING_MODEL,
  DEFAULT_MISTRAL_EMBEDDING_MODEL,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  DEFAULT_VOYAGE_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_ADAPTERS,
  deepinfraMemoryEmbeddingProviderAdapter,
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
      expect(DEFAULT_OPENROUTER_EMBEDDING_MODEL).toBe(
        "openai/text-embedding-3-small",
      );
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
      expect(deepinfraMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(
        13,
      );
    });
    it("test_voyage_adapter_shape", () => {
      expect(voyageMemoryEmbeddingProviderAdapter.id).toBe("voyage");
      expect(voyageMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(voyageMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(14);
    });
    it("test_openrouter_adapter_shape", () => {
      expect(openRouterMemoryEmbeddingProviderAdapter.id).toBe("openrouter");
      expect(openRouterMemoryEmbeddingProviderAdapter.transport).toBe("remote");
      expect(openRouterMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(
        15,
      );
    });
    it("test_ollama_adapter_is_only_local_transport", () => {
      expect(ollamaMemoryEmbeddingProviderAdapter.id).toBe("ollama");
      // The single transport: "local" adapter in the cluster.
      expect(ollamaMemoryEmbeddingProviderAdapter.transport).toBe("local");
      expect(ollamaMemoryEmbeddingProviderAdapter.autoSelectPriority).toBe(10);
    });
  });

  describe("MEMORY_EMBEDDING_ADAPTERS catalog", () => {
    it("test_catalog_contains_canonical_6_provider_ids", () => {
      const ids = Object.keys(MEMORY_EMBEDDING_ADAPTERS).sort();
      expect(ids).toEqual(
        [
          "deepinfra",
          "mistral",
          "ollama",
          "openai",
          "openrouter",
          "voyage",
        ].sort(),
      );
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
