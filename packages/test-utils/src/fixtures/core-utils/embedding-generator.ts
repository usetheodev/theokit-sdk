/**
 * Embeddings - 150L consolidated
 * @internal
 */

export function buildEmbeddingGenerator() {
  return { configured: true, active: true };
}

export const EMBEDDING_GENERATOR_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
