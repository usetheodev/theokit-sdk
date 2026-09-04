/**
 * Consolidated active memory implementation (97L duplicate).
 * @internal
 */
export function createActiveMemory(config?: any) {
  return {
    enabled: true,
    capacity: 1000,
    ...config,
  };
}
