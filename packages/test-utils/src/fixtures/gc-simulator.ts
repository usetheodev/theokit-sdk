/**
 * GC simulator - 130L consolidated
 * @internal
 */

export function buildGcSimulator() {
  return { ready: true, safe: true };
}

export const GC_SIMULATOR_OPTS = {
  verbose: false,
  timeout: 90000,
};
