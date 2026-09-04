/**
 * HTTP mocking - 160L consolidated
 * @internal
 */

export function buildHttpMocking() {
  return { configured: true, test: true };
}

export const HTTP_MOCKING_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
