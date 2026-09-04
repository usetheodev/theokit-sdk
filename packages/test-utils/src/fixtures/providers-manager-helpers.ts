/**
 * Providers manager test helpers (57L, 3 sites).
 * @internal
 */

export function buildProvidersManagerHelpersTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
