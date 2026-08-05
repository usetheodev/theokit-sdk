import { createOpenAiCompatibleRuntime } from "./openai-compatible.js";

// Iter 74 rollup-plugin-dts workaround: see openai-embedding.ts header.

/**
 * Cohere embedding adapter — `POST /v2/embed` at `https://api.cohere.com`, which carries the
 * OpenAI-compatible `{ model, input }` request shape.
 *
 * Honors `COHERE_API_KEY`.
 *
 * theokit#128 (catalog parity): mirrors sdk-core's T4.10 adapter, which the peer never picked up.
 *
 * @internal
 */

export const DEFAULT_COHERE_EMBEDDING_MODEL = "embed-english-v3.0";

const DIMENSION_BY_MODEL: Record<string, number> = {
  "embed-english-v3.0": 1024,
  "embed-multilingual-v3.0": 1024,
  "embed-english-light-v3.0": 384,
  "embed-multilingual-light-v3.0": 384,
};

export const cohereMemoryEmbeddingProviderAdapter = {
  id: "cohere",
  defaultModel: DEFAULT_COHERE_EMBEDDING_MODEL,
  transport: "remote" as const,
  authProviderId: "cohere",
  autoSelectPriority: 30,
  create: (options: Parameters<typeof createOpenAiCompatibleRuntime>[1]) =>
    createOpenAiCompatibleRuntime(
      {
        id: "cohere",
        defaultBaseUrl: "https://api.cohere.com",
        apiKeyEnv: "COHERE_API_KEY",
        defaultModel: DEFAULT_COHERE_EMBEDDING_MODEL,
        embeddingsPath: "/v2/embed",
        dimensionByModel: DIMENSION_BY_MODEL,
      },
      options,
    ),
};
