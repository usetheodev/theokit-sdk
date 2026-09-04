/**
 * Floor test helpers (45L, 3 sites).
 * @internal
 */

export function buildFloorTestHelpersTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
