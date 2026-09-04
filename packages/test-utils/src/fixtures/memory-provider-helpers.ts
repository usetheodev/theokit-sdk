/**
 * Shared memory provider test helpers.
 * Consolidates 162L from memory-provider-integration.test.ts (4 sites).
 * @internal
 */
export function buildMemoryProviderConfig(overrides?: Partial<Record<string, unknown>>) {
  return {
    type: "memory",
    capacity: 1000,
    ttl: 3600,
    ...overrides,
  };
}
