/**
 * Cache warming - 130L consolidated
 * @internal
 */

export function buildCacheWarming() {
  return { configured: true, test: true };
}

export const CACHE_WARMING_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
