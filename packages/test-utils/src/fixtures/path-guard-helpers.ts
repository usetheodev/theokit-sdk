/**
 * Path guard test helpers (66L, 3 sites).
 * @internal
 */

export function buildPathGuardHelpersTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
