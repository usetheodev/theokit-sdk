/**
 * Artifacts test helpers (41L, 3 sites).
 * @internal
 */

export function buildArtifactHelpersTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
