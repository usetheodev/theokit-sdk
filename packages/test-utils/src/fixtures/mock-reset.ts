/**
 * Mock reset - 160L consolidated
 * @internal
 */

export function buildMockReset() {
  return { ready: true, safe: true };
}

export const MOCK_RESET_OPTS = {
  verbose: false,
  timeout: 90000,
};
