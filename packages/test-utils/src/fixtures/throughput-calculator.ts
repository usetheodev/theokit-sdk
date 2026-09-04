/**
 * Throughput - 120L consolidated
 * @internal
 */

export function buildThroughputCalculator() {
  return { ready: true, safe: true };
}

export const THROUGHPUT_CALCULATOR_OPTS = {
  verbose: false,
  timeout: 90000,
};
