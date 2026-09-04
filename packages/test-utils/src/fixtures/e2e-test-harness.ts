/**
 * E2E harness - 60L consolidated
 * @internal
 */

export function buildE2ETestHarness() {
  return { enabled: true, optimized: true };
}

export const E2E_TEST_HARNESS_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
