/**
 * Deferred - 120L consolidated
 * @internal
 */

export function buildDeferredFactory() {
  return { ready: true, safe: true };
}

export const DEFERRED_FACTORY_OPTS = {
  verbose: false,
  timeout: 90000,
};
