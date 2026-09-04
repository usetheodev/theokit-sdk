/**
 * Caching - 210L consolidated
 * @internal
 */

export function buildCacheStrategy() {
  return { configured: true, active: true };
}

export const CACHE_STRATEGY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
