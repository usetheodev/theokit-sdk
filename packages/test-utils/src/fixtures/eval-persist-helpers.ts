/**
 * Eval persist test helpers (44L, 3 sites).
 * @internal
 */

export function buildEvalPersistHelpersTestCase(overrides?: Record<string, any>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
