/**
 * Shared Claude compatibility test helpers.
 * Consolidates 190L from claude-code-agent-compat.test.ts (3 sites).
 * @internal
 */
export function buildClaudeCompatTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    claudeVersion: "claude-3-5-sonnet",
    compatibilityLevel: "full",
    ...overrides,
  };
}
