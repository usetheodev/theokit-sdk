/**
 * Integration - 70L consolidated
 * @internal
 */

export function buildIntegrationTestHelpers() {
  return { enabled: true, optimized: true };
}

export const INTEGRATION_TEST_HELPERS_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
