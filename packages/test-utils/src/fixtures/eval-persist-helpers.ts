/**
 * Eval persist test helpers (44L, 3 sites).
 * @internal
 */

export function buildEvalPersistHelpersTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
