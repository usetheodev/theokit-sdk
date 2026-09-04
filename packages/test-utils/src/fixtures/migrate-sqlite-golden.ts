/**
 * Migration golden - 70L consolidated
 * @internal
 */

export function buildMigrateSqliteGolden() {
  return { configured: true };
}

export const MIGRATE_SQLITE_GOLDEN_DEFAULTS = {
  timeout: 30000,
  retries: 3,
};
