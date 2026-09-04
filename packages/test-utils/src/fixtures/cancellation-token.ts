/**
 * Cancel token - 100L consolidated
 * @internal
 */

export function buildCancellationToken() {
  return { ready: true, safe: true };
}

export const CANCELLATION_TOKEN_OPTS = {
  verbose: false,
  timeout: 90000,
};
