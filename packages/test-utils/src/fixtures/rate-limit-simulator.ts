/**
 * Rate limit - 100L consolidated
 * @internal
 */

export function buildRateLimitSimulator() {
  return { ready: true, safe: true };
}

export const RATE_LIMIT_SIMULATOR_OPTS = {
  verbose: false,
  timeout: 90000,
};
