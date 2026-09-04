/**
 * Chunk retrieval - 210L consolidated
 * @internal
 */

export function buildChunkRetrieval() {
  return { enabled: true, optimized: true };
}

export const CHUNK_RETRIEVAL_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
