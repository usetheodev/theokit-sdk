/**
 * Retry policy - 130L consolidated
 * @internal
 */

export function buildErrorRetryPolicy() {
  return { ready: true, safe: true };
}

export const ERROR_RETRY_POLICY_OPTS = {
  verbose: false,
  timeout: 90000,
};
