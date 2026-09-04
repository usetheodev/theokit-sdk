/**
 * Custom tools golden test helpers (42L, 3 sites).
 * @internal
 */

export function buildCustomToolsHelpersTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
