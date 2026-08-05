import { createOpenAiCompatibleRuntime } from "./openai-compatible.js";

// Iter 74 rollup-plugin-dts workaround: see openai-embedding.ts header.

/**
 * Azure OpenAI embedding adapter.
 *
 * Azure addresses the DEPLOYMENT in the path rather than the model in the body:
 * `https://{resource}.openai.azure.com/openai/deployments/{deployment}/embeddings?api-version=...`.
 * `{model}` in `embeddingsPath` is substituted by `createOpenAiCompatibleRuntime`, so `model` here
 * names the Azure deployment.
 *
 * `AZURE_OPENAI_ENDPOINT` supplies the resource URL (without the `/openai/...` suffix);
 * `AZURE_OPENAI_API_KEY` the credential.
 *
 * theokit#128 (catalog parity): sdk-core gained this adapter in T4.10 and the peer never mirrored
 * it, so a `sdk-memory` user asking for `azure-openai` was rejected by a provider the SDK's own
 * `Theokit.inspect.embeddingAdapters()` advertised.
 *
 * @internal
 */

export const DEFAULT_AZURE_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

const DIMENSION_BY_MODEL: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

export const azureOpenAiMemoryEmbeddingProviderAdapter = {
  id: "azure-openai",
  defaultModel: DEFAULT_AZURE_OPENAI_EMBEDDING_MODEL,
  transport: "remote" as const,
  authProviderId: "azure-openai",
  autoSelectPriority: 25,
  create: (options: Parameters<typeof createOpenAiCompatibleRuntime>[1]) =>
    createOpenAiCompatibleRuntime(
      {
        id: "azure-openai",
        defaultBaseUrl: "https://your-resource.openai.azure.com",
        apiKeyEnv: "AZURE_OPENAI_API_KEY",
        baseUrlEnv: "AZURE_OPENAI_ENDPOINT",
        defaultModel: DEFAULT_AZURE_OPENAI_EMBEDDING_MODEL,
        embeddingsPath: "/openai/deployments/{model}/embeddings?api-version=2024-02-01",
        dimensionByModel: DIMENSION_BY_MODEL,
      },
      options,
    ),
};
