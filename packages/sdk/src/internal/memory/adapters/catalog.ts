import type { MemoryEmbeddingProviderAdapter } from "../embedding-adapter.js";
import { deepinfraMemoryEmbeddingProviderAdapter } from "./deepinfra-embedding.js";
import { mistralMemoryEmbeddingProviderAdapter } from "./mistral-embedding.js";
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
 * ship in v1.0. `lmstudio`, `google`, `bedrock` are deferred to v1.1.
 *
 * @internal
 */
export const MEMORY_EMBEDDING_ADAPTERS: Readonly<Record<string, MemoryEmbeddingProviderAdapter>> = {
  openai: openAiMemoryEmbeddingProviderAdapter,
  mistral: mistralMemoryEmbeddingProviderAdapter,
  openrouter: openRouterMemoryEmbeddingProviderAdapter,
  voyage: voyageMemoryEmbeddingProviderAdapter,
  deepinfra: deepinfraMemoryEmbeddingProviderAdapter,
};
