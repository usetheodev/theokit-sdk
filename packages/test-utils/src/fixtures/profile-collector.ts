/**
 * Profiler - 160L consolidated
 * @internal
 */

export function buildProfileCollector() {
  return { ready: true, safe: true };
}

export const PROFILE_COLLECTOR_OPTS = {
  verbose: false,
  timeout: 90000,
};
