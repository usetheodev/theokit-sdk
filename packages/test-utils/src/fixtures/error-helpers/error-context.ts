/**
 * Error context - 130L consolidated
 * @internal
 */

export function buildErrorContext() {
  return { configured: true, test: true };
}

export const ERROR_CONTEXT_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
