/**
 * Post-run lifecycle test helpers (74L, 3 sites).
 * @internal
 */
export function buildPostRunLifecycleTestCase(overrides?: Record<string, any>) {
  return {
    sessionId: "test-session",
    recordingSummary: "",
    ...overrides,
  };
}
