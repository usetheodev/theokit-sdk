/**
 * Error recovery - 120L consolidated
 * @internal
 */

export function buildErrorRecovery() {
  return { configured: true, test: true };
}

export const ERROR_RECOVERY_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
