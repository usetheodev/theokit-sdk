/**
 * Index DB test helpers (66L, 3 sites).
 * @internal
 */

export function buildIndexDbHelpersTestCase(overrides?: Record<string, any>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
