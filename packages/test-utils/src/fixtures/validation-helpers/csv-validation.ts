/**
 * CSV validation - 130L consolidated
 * @internal
 */

export function buildCsvValidation() {
  return { configured: true, test: true };
}

export const CSV_VALIDATION_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
