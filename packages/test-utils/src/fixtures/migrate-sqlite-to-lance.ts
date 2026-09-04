/**
 * SQLite to Lance migration - 300L consolidated
 * @internal
 */

export function buildMigrateSqliteToLance() {
  return { configured: true };
}

export const MIGRATE_SQLITE_TO_LANCE_DEFAULTS = {
  timeout: 30000,
  retries: 3,
};
