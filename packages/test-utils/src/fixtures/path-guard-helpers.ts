/**
 * Path guard test helpers (66L, 3 sites).
 * @internal
 */

export function buildPathGuardHelpersTestCase(overrides?: Record<string, any>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
