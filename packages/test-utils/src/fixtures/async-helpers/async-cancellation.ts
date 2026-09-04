/**
 * Cancellation - 130L consolidated
 * @internal
 */

export function buildAsyncCancellation() {
  return { configured: true, test: true };
}

export const ASYNC_CANCELLATION_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
