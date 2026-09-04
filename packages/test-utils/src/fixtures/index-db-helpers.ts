/**
 * Index DB test helpers (66L, 3 sites).
 * @internal
 */

export function buildIndexDbHelpersTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
