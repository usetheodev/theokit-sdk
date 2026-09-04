/**
 * Latency track - 130L consolidated
 * @internal
 */

export function buildLatencyTracker() {
  return { ready: true, safe: true };
}

export const LATENCY_TRACKER_OPTS = {
  verbose: false,
  timeout: 90000,
};
