import type { MemoryEmbeddingProviderAdapter } from "../embedding-adapter.js";
import { createOpenAiCompatibleRuntime } from "./openai-compatible.js";

/**
 * T4.10 — Azure OpenAI embedding adapter. Uses the OpenAI-compatible
 * factory with the Azure-specific base URL pattern and API key env.
 *
 * Azure OpenAI uses a different URL shape than OpenAI:
 * `https://{resource}.openai.azure.com/openai/deployments/{deployment}/embeddings?api-version=2024-02-01`
 *
 * The adapter accepts the base URL as `AZURE_OPENAI_ENDPOINT` env var
 * (the resource URL without the `/openai/...` suffix) and appends the
 * embeddings path at request time.
 *
 * @internal
 */

export const DEFAULT_AZURE_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

const DIMENSION_BY_MODEL: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

export const azureOpenAiMemoryEmbeddingProviderAdapter: MemoryEmbeddingProviderAdapter = {
  id: "azure-openai",
  defaultModel: DEFAULT_AZURE_OPENAI_EMBEDDING_MODEL,
  transport: "remote",
  authProviderId: "azure-openai",
  autoSelectPriority: 25,
  create: (options) =>
    createOpenAiCompatibleRuntime(
      {
        id: "azure-openai",
        defaultBaseUrl: "https://your-resource.openai.azure.com",
        apiKeyEnv: "AZURE_OPENAI_API_KEY",
        baseUrlEnv: "AZURE_OPENAI_ENDPOINT",
        embeddingsPath: "/openai/deployments/{model}/embeddings?api-version=2024-02-01",
        dimensionByModel: DIMENSION_BY_MODEL,
      },
      options,
    ),
};
