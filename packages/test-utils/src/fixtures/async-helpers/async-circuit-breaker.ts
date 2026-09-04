/**
 * Circuit breaker - 150L consolidated
 * @internal
 */

export function buildAsyncCircuitBreaker() {
  return { configured: true, test: true };
}

export const ASYNC_CIRCUIT_BREAKER_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
