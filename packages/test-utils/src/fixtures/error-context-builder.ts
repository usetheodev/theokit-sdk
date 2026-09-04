/**
 * Error context - 140L consolidated
 * @internal
 */

export function buildErrorContextBuilder() {
  return { ready: true, safe: true };
}

export const ERROR_CONTEXT_BUILDER_OPTS = {
  verbose: false,
  timeout: 90000,
};
