/**
 * Subagent delegation test helpers (50L, 3 sites).
 * @internal
 */
export function buildSubagentDelegationTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    subagent: "test-subagent",
    task: "test-task",
    ...overrides,
  };
}
