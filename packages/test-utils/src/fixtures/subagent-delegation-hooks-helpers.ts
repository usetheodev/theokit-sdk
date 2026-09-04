/**
 * Subagent delegation hooks (45L, 3 sites).
 * @internal
 */

export function buildSubagentDelegationHooksHelpersTestCase(
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    name: "test-case",
    ...overrides,
  };
}
