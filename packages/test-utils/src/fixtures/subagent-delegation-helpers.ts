/**
 * Subagent delegation test helpers (50L, 3 sites).
 * @internal
 */
export function buildSubagentDelegationTestCase(overrides?: Record<string, any>) {
  return {
    subagent: "test-subagent",
    task: "test-task",
    ...overrides,
  };
}
