/**
 * Post-run lifecycle test helpers (74L, 3 sites).
 * @internal
 */
export function buildPostRunLifecycleTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    sessionId: "test-session",
    recordingSummary: "",
    ...overrides,
  };
}
