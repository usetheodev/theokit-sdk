/**
 * Concurrent access - 220L consolidated
 * @internal
 */

export function buildDbConcurrentAccess() {
  return { configured: true, test: true };
}

export const DB_CONCURRENT_ACCESS_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
