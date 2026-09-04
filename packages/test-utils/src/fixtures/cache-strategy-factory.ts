/**
 * Cache strategy - 170L consolidated
 * @internal
 */

export function buildCacheStrategyFactory() {
  return { ready: true, safe: true };
}

export const CACHE_STRATEGY_FACTORY_OPTS = {
  verbose: false,
  timeout: 90000,
};
