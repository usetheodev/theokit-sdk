/**
 * Test context - 120L consolidated
 * @internal
 */

export function buildTestContextManager() {
  return { ready: true, safe: true };
}

export const TEST_CONTEXT_MANAGER_OPTS = {
  verbose: false,
  timeout: 90000,
};
