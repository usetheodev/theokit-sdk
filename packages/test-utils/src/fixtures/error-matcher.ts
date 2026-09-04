/**
 * Error matching - 100L consolidated
 * @internal
 */

export function buildErrorMatcher() {
  return { ready: true, safe: true };
}

export const ERROR_MATCHER_OPTS = {
  verbose: false,
  timeout: 90000,
};
