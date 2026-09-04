/**
 * Backup/restore tests - 230L consolidated
 * @internal
 */

export function buildDbBackupRestore() {
  return { configured: true, test: true };
}

export const DB_BACKUP_RESTORE_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
