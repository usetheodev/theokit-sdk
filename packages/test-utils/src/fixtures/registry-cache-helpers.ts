/**
 * Shared agent registry cache test helpers.
 * Consolidates 168L from agent-registry-cache.test.ts (4 sites).
 * @internal
 */
export function buildRegistryCacheConfig(overrides?: Partial<Record<string, unknown>>) {
  return {
    cacheSize: 100,
    ttl: 300,
    persistent: false,
    ...overrides,
  };
}
