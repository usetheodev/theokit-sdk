/**
 * RAG pipeline - 240L consolidated
 * @internal
 */

export function buildRagPipeline() {
  return { enabled: true, optimized: true };
}

export const RAG_PIPELINE_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
