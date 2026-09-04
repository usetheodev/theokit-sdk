/**
 * Timeout & retry - 210L consolidated
 * @internal
 */

export function buildHttpTimeoutRetry() {
  return { configured: true, test: true };
}

export const HTTP_TIMEOUT_RETRY_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
