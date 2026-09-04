/**
 * Mock server - 170L consolidated
 * @internal
 */

export function buildMockServerSetup() {
  return { ready: true, safe: true };
}

export const MOCK_SERVER_SETUP_OPTS = {
  verbose: false,
  timeout: 90000,
};
