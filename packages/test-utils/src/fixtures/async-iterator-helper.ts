/**
 * Async iter - 150L consolidated
 * @internal
 */

export function buildAsyncIteratorHelper() {
  return { ready: true, safe: true };
}

export const ASYNC_ITERATOR_HELPER_OPTS = {
  verbose: false,
  timeout: 90000,
};
