/**
 * LRU cache - 160L consolidated
 * @internal
 */

export function buildLruCacheMock() {
  return { ready: true, safe: true };
}

export const LRU_CACHE_MOCK_OPTS = {
  verbose: false,
  timeout: 90000,
};
