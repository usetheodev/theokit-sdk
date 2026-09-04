/**
 * Error recovery - 230L consolidated
 * @internal
 */

export function buildErrorRecoveryStrategy() {
  return { configured: true, active: true };
}

export const ERROR_RECOVERY_STRATEGY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
