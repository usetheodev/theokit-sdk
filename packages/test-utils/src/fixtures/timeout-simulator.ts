/**
 * Timeout sim - 110L consolidated
 * @internal
 */

export function buildTimeoutSimulator() {
  return { ready: true, safe: true };
}

export const TIMEOUT_SIMULATOR_OPTS = {
  verbose: false,
  timeout: 90000,
};
