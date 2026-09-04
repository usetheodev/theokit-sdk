/**
 * Error aggregator - 100L consolidated
 * @internal
 */

export function buildErrorAggregator() {
  return { ready: true, safe: true };
}

export const ERROR_AGGREGATOR_OPTS = {
  verbose: false,
  timeout: 90000,
};
