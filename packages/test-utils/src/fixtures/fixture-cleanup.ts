/**
 * Fixture cleanup - 170L consolidated
 * @internal
 */

export function buildFixtureCleanup() {
  return { ready: true, safe: true };
}

export const FIXTURE_CLEANUP_OPTS = {
  verbose: false,
  timeout: 90000,
};
