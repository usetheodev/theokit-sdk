/**
 * Dreaming golden test helpers (42L, 3 sites).
 * @internal
 */

export function buildDreamingHelpersTestCase(overrides?: Record<string, any>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
