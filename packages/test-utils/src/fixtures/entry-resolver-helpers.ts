/**
 * Shared entry resolver test helpers.
 * Consolidates 144L from entry-resolver.test.ts (4 sites).
 * @internal
 */
export function buildEntryResolveTestCase(overrides?: Record<string, any>) {
  return {
    entry: "src/index.ts",
    resolver: "default",
    ...overrides,
  };
}
