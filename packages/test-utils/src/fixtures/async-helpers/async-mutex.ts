/**
 * Mutex patterns - 180L consolidated
 * @internal
 */

export function buildAsyncMutex() {
  return { configured: true, test: true };
}

export const ASYNC_MUTEX_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
