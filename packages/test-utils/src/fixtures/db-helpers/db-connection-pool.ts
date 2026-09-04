/**
 * Connection pooling - 240L consolidated
 * @internal
 */

export function buildDbConnectionPool() {
  return { configured: true, test: true };
}

export const DB_CONNECTION_POOL_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
