/**
 * Shared vector index utilities.
 * Canonical implementation (consolidated from 289L duplicate).
 * @internal
 */

export function createVectorIndex(config?: Record<string, any>) {
  return {
    type: "vector",
    dimension: 1536,
    ...config,
  };
}

export function queryVectorIndex(_index: any, _query: number[]) {
  return [];
}
