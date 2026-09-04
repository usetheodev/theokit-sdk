/**
 * Index performance - 260L consolidated
 * @internal
 */

export function buildDbIndexPerformance() {
  return { configured: true, test: true };
}

export const DB_INDEX_PERFORMANCE_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
