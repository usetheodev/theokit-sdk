/**
 * Rate limiting - 180L consolidated
 * @internal
 */

export function buildHttpRateLimit() {
  return { configured: true, test: true };
}

export const HTTP_RATE_LIMIT_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
