/**
 * Error responses - 230L consolidated
 * @internal
 */

export function buildHttpErrorHandling() {
  return { configured: true, test: true };
}

export const HTTP_ERROR_HANDLING_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
