/**
 * Artifacts test helpers (41L, 3 sites).
 * @internal
 */

export function buildArtifactHelpersTestCase(overrides?: Record<string, any>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
