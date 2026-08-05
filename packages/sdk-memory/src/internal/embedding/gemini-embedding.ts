import { createOpenAiCompatibleRuntime } from "./openai-compatible.js";

// Iter 74 rollup-plugin-dts workaround: see openai-embedding.ts header.

/**
 * Google Gemini embedding adapter — the OpenAI-compatible surface at
 * `https://generativelanguage.googleapis.com/v1/embeddings`.
 *
 * Gemini's NATIVE embedding endpoint has a different shape
 * (`POST /v1beta/models/{model}:embedContent`); this adapter deliberately targets the
 * OpenAI-compatible one so it composes with the shared runtime.
 *
 * Honors `GEMINI_API_KEY`.
 *
 * theokit#128 (catalog parity): mirrors sdk-core's T4.10 adapter, which the peer never picked up.
 *
 * @internal
 */

export const DEFAULT_GEMINI_EMBEDDING_MODEL = "text-embedding-004";

const DIMENSION_BY_MODEL: Record<string, number> = {
  "text-embedding-004": 768,
  "embedding-001": 768,
};

export const geminiMemoryEmbeddingProviderAdapter = {
  id: "gemini",
  defaultModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
  transport: "remote" as const,
  authProviderId: "gemini",
  autoSelectPriority: 30,
  create: (options: Parameters<typeof createOpenAiCompatibleRuntime>[1]) =>
    createOpenAiCompatibleRuntime(
      {
        id: "gemini",
        defaultBaseUrl: "https://generativelanguage.googleapis.com",
        apiKeyEnv: "GEMINI_API_KEY",
        defaultModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
        dimensionByModel: DIMENSION_BY_MODEL,
      },
      options,
    ),
};
