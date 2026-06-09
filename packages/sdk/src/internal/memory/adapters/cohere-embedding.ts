import type { MemoryEmbeddingProviderAdapter } from "../embedding-adapter.js";
import { createOpenAiCompatibleRuntime } from "./openai-compatible.js";

/**
 * T4.10 — Cohere embedding adapter. Cohere's v2 embed API is
 * OpenAI-compatible at `/v2/embed` with the same request/response shape.
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

export const cohereMemoryEmbeddingProviderAdapter: MemoryEmbeddingProviderAdapter = {
  id: "cohere",
  defaultModel: DEFAULT_COHERE_EMBEDDING_MODEL,
  transport: "remote",
  authProviderId: "cohere",
  autoSelectPriority: 30,
  create: (options) =>
    createOpenAiCompatibleRuntime(
      {
        id: "cohere",
        defaultBaseUrl: "https://api.cohere.com",
        apiKeyEnv: "COHERE_API_KEY",
        embeddingsPath: "/v2/embed",
        dimensionByModel: DIMENSION_BY_MODEL,
      },
      options,
    ),
};
