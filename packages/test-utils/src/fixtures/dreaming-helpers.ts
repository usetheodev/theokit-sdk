/**
 * Dreaming golden test helpers (42L, 3 sites).
 * @internal
 */

export function buildDreamingHelpersTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
