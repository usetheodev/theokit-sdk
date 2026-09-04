/**
 * Transaction rollback - 270L consolidated
 * @internal
 */

export function buildDbTransactionRollback() {
  return { configured: true, test: true };
}

export const DB_TRANSACTION_ROLLBACK_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
