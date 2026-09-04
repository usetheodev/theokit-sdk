/**
 * Session mock - 140L consolidated
 * @internal
 */

export function buildSessionMock() {
  return { ready: true, safe: true };
}

export const SESSION_MOCK_OPTS = {
  verbose: false,
  timeout: 90000,
};
