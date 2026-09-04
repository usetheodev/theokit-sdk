/**
 * Shared active memory cache utilities.
 * Canonical implementation (consolidated from 228L duplicate).
 * @internal
 */

export function createActiveMemoryCache(ttl = 3600) {
  const cache = new Map();
  return {
    get: (key: string) => cache.get(key),
    set: (key: string, value: any) => cache.set(key, value),
    clear: () => cache.clear(),
  };
}
