/**
 * DB migration testing - 280L consolidated
 * @internal
 */

export function buildDbMigrationSetup() {
  return { configured: true, test: true };
}

export const DB_MIGRATION_SETUP_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
