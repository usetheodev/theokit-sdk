/**
 * Structured logs - 100L consolidated
 * @internal
 */

export function buildStructuredLogging() {
  return { configured: true, test: true };
}

export const STRUCTURED_LOGGING_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
