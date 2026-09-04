/**
 * JSON schema - 140L consolidated
 * @internal
 */

export function buildJsonSchemaValidation() {
  return { configured: true, test: true };
}

export const JSON_SCHEMA_VALIDATION_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
