/**
 * Runner test helpers (45L, 3 sites).
 * @internal
 */

export function buildRunnerHelpersTestCase(overrides?: Record<string, any>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
