/**
 * Span factory - 140L consolidated
 * @internal
 */

export function buildSpanFactory() {
  return { ready: true, safe: true };
}

export const SPAN_FACTORY_OPTS = {
  verbose: false,
  timeout: 90000,
};
