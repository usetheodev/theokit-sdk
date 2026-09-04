/**
 * Schema migration - 210L consolidated
 * @internal
 */

export function buildDbSchemaEvolution() {
  return { configured: true, test: true };
}

export const DB_SCHEMA_EVOLUTION_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
