import type { MemoryEmbeddingProviderAdapter } from "../embedding-adapter.js";
import { azureOpenAiMemoryEmbeddingProviderAdapter } from "./azure-openai-embedding.js";
import { cohereMemoryEmbeddingProviderAdapter } from "./cohere-embedding.js";
import { deepinfraMemoryEmbeddingProviderAdapter } from "./deepinfra-embedding.js";
import { geminiMemoryEmbeddingProviderAdapter } from "./gemini-embedding.js";
import { jinaMemoryEmbeddingProviderAdapter } from "./jina-embedding.js";
import { mistralMemoryEmbeddingProviderAdapter } from "./mistral-embedding.js";
import { ollamaMemoryEmbeddingProviderAdapter } from "./ollama-embedding.js";
import { openAiMemoryEmbeddingProviderAdapter } from "./openai-embedding.js";
import { openRouterMemoryEmbeddingProviderAdapter } from "./openrouter-embedding.js";
import { voyageMemoryEmbeddingProviderAdapter } from "./voyage-embedding.js";

/**
 * Memory embedding adapter catalog, indexed by provider id.
 *
 * Only adapters with full, tested implementations are exposed. The
 * `openrouter` provider proxies through OpenRouter to whichever embedding
 * model the caller selects via `model` (e.g.
 * `"openai/text-embedding-3-small"`, `"mistralai/mistral-embed"`).
 *
 * Locked by ADR D11: `openai`, `mistral`, `openrouter`, `voyage`, `deepinfra`
 * ship in v1.0. ADR D183: `ollama` added — first `transport: "local"`
 * adapter, enables 100%-local RAG (no remote API key needed).
 * `lmstudio`, `google`, `bedrock` are deferred to v1.1.
 *
 * @internal
 */
export const MEMORY_EMBEDDING_ADAPTERS: Readonly<Record<string, MemoryEmbeddingProviderAdapter>> = {
  openai: openAiMemoryEmbeddingProviderAdapter,
  mistral: mistralMemoryEmbeddingProviderAdapter,
  openrouter: openRouterMemoryEmbeddingProviderAdapter,
  voyage: voyageMemoryEmbeddingProviderAdapter,
  deepinfra: deepinfraMemoryEmbeddingProviderAdapter,
  ollama: ollamaMemoryEmbeddingProviderAdapter,
  // T4.10 — 4 new adapters expanding embedding provider coverage.
  "azure-openai": azureOpenAiMemoryEmbeddingProviderAdapter,
  cohere: cohereMemoryEmbeddingProviderAdapter,
  jina: jinaMemoryEmbeddingProviderAdapter,
  gemini: geminiMemoryEmbeddingProviderAdapter,
};
