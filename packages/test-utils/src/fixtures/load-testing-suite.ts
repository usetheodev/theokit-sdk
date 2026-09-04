/**
 * Load tests - 100L consolidated
 * @internal
 */

export function buildLoadTestingSuite() {
  return { enabled: true, optimized: true };
}

export const LOAD_TESTING_SUITE_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
