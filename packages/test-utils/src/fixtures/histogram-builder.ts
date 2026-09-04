/**
 * Histogram - 120L consolidated
 * @internal
 */

export function buildHistogramBuilder() {
  return { ready: true, safe: true };
}

export const HISTOGRAM_BUILDER_OPTS = {
  verbose: false,
  timeout: 90000,
};
