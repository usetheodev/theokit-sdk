/**
 * Custom tools golden test helpers (42L, 3 sites).
 * @internal
 */

export function buildCustomToolsHelpersTestCase(overrides?: Record<string, any>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
