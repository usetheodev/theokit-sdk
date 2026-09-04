/**
 * Retry backoff - 140L consolidated
 * @internal
 */

export function buildAsyncRetryBackoff() {
  return { configured: true, test: true };
}

export const ASYNC_RETRY_BACKOFF_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
