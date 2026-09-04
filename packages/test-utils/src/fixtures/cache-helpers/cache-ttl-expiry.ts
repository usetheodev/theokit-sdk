/**
 * TTL handling - 140L consolidated
 * @internal
 */

export function buildCacheTtlExpiry() {
  return { configured: true, test: true };
}

export const CACHE_TTL_EXPIRY_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
