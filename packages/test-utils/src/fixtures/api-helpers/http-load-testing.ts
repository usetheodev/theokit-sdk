/**
 * Load testing - 170L consolidated
 * @internal
 */

export function buildHttpLoadTesting() {
  return { configured: true, test: true };
}

export const HTTP_LOAD_TESTING_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
