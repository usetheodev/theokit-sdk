/**
 * Schema validation - 180L consolidated
 * @internal
 */

export function buildSchemaValidation() {
  return { configured: true, test: true };
}

export const SCHEMA_VALIDATION_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
