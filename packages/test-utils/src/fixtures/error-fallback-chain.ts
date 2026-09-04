/**
 * Fallback chain - 120L consolidated
 * @internal
 */

export function buildErrorFallbackChain() {
  return { ready: true, safe: true };
}

export const ERROR_FALLBACK_CHAIN_OPTS = {
  verbose: false,
  timeout: 90000,
};
