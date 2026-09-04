/**
 * Rate limits - 150L consolidated
 * @internal
 */

export function buildRateLimitControl() {
  return { enabled: true, optimized: true };
}

export const RATE_LIMIT_CONTROL_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
