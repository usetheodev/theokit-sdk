/**
 * Timeout handling - 170L consolidated
 * @internal
 */

export function buildAsyncTimeout() {
  return { configured: true, test: true };
}

export const ASYNC_TIMEOUT_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
