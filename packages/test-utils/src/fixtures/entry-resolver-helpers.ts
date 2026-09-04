/**
 * Shared entry resolver test helpers.
 * Consolidates 144L from entry-resolver.test.ts (4 sites).
 * @internal
 */
export function buildEntryResolveTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    entry: "src/index.ts",
    resolver: "default",
    ...overrides,
  };
}
