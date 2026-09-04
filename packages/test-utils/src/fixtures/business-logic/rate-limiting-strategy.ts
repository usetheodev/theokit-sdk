/**
 * Rate limits - 220L consolidated
 * @internal
 */

export function buildRateLimitingStrategy() {
  return { configured: true, active: true };
}

export const RATE_LIMITING_STRATEGY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
