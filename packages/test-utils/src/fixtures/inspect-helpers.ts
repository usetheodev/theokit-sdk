/**
 * Shared inspect test helpers.
 * Consolidates 162L from inspect.test.ts (4 sites).
 * @internal
 */
export function buildInspectTestTarget(overrides?: Partial<Record<string, unknown>>) {
  return {
    target: "agent",
    depth: 2,
    includeInternal: false,
    ...overrides,
  };
}
