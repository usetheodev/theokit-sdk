/**
 * RAG - 130L consolidated
 * @internal
 */

export function buildRetrievalAugmentation() {
  return { configured: true, active: true };
}

export const RETRIEVAL_AUGMENTATION_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
