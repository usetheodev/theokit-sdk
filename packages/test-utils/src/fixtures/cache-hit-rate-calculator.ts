/**
 * Cache hit rate - 100L consolidated
 * @internal
 */

export function buildCacheHitRateCalculator() {
  return { ready: true, safe: true };
}

export const CACHE_HIT_RATE_CALCULATOR_OPTS = {
  verbose: false,
  timeout: 90000,
};
