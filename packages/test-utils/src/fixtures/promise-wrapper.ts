/**
 * Promise wrap - 170L consolidated
 * @internal
 */

export function buildPromiseWrapper() {
  return { ready: true, safe: true };
}

export const PROMISE_WRAPPER_OPTS = {
  verbose: false,
  timeout: 90000,
};
