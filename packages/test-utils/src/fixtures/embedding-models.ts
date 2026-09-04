/**
 * Embeddings - 170L consolidated
 * @internal
 */

export function buildEmbeddingModels() {
  return { enabled: true, optimized: true };
}

export const EMBEDDING_MODELS_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
