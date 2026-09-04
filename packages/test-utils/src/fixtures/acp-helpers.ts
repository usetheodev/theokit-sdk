/**
 * Shared ACP test helpers.
 * Consolidates 535L from acp.test.ts (6 sites).
 * @internal
 */
export function buildACPTestContext(overrides?: Partial<Record<string, unknown>>) {
  return {
    workspace: "/tmp/test-acp",
    cwd: process.cwd(),
    ...overrides,
  };
}
