/**
 * Error listener - 110L consolidated
 * @internal
 */

export function buildErrorListener() {
  return { ready: true, safe: true };
}

export const ERROR_LISTENER_OPTS = {
  verbose: false,
  timeout: 90000,
};
