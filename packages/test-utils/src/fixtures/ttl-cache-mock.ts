/**
 * TTL cache - 150L consolidated
 * @internal
 */

export function buildTtlCacheMock() {
  return { ready: true, safe: true };
}

export const TTL_CACHE_MOCK_OPTS = {
  verbose: false,
  timeout: 90000,
};
