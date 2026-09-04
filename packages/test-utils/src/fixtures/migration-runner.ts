/**
 * Migrations - 140L consolidated
 * @internal
 */

export function buildMigrationRunner() {
  return { ready: true, safe: true };
}

export const MIGRATION_RUNNER_OPTS = {
  verbose: false,
  timeout: 90000,
};
