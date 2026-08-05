import type { MemoryEmbeddingProviderAdapter } from "./embedding-adapter.js";
import { createOpenAiCompatibleRuntime } from "./openai-compatible.js";

/**
 * **Iter 74 rollup-plugin-dts workaround:** importing
 * `MemoryEmbeddingProviderAdapter` from sibling `./embedding-adapter.js`
 * fails dts emit because no public type reaches it transitively yet
 * (same iter 48/53/55/66/67/69/72 class). Fix: drop the explicit
 * type annotation on the exported adapter; TS infers the structural
 * shape from the literal, and the catalog (iter 37 / this same iter)
 * pin assignability against the canonical interface via its own
 * `Record<string, MemoryEmbeddingProviderAdapter>` constraint.
 *
 * @internal
 */

/**
 * OpenAI embedding adapter (ADR D3) — built on the shared OpenAI-compatible
 * factory. Native fetch only.
 *
 * Iter 74 (Stage 3 source-move #31): hybrid copy from sdk-core's
 * `internal/memory/adapters/openai-embedding.ts`. Composes iter 45's
 * `MemoryEmbeddingProviderAdapter` + iter 73's
 * `createOpenAiCompatibleRuntime`.
 *
 * @internal
 */

export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

const DIMENSION_BY_MODEL: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

export const openAiMemoryEmbeddingProviderAdapter: MemoryEmbeddingProviderAdapter = {
  id: "openai",
  defaultModel: DEFAULT_OPENAI_EMBEDDING_MODEL,
  transport: "remote" as const,
  authProviderId: "openai",
  autoSelectPriority: 20,
  create: (options: Parameters<typeof createOpenAiCompatibleRuntime>[1]) =>
    createOpenAiCompatibleRuntime(
      {
        id: "openai",
        defaultBaseUrl: "https://api.openai.com",
        apiKeyEnv: "OPENAI_API_KEY",
        baseUrlEnv: "OPENAI_API_BASE_URL",
        defaultModel: DEFAULT_OPENAI_EMBEDDING_MODEL,
        dimensionByModel: DIMENSION_BY_MODEL,
      },
      options,
    ),
};
