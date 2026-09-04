/**
 * Error logging - 110L consolidated
 * @internal
 */

export function buildErrorLogging() {
  return { configured: true, test: true };
}

export const ERROR_LOGGING_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
