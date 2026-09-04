/**
 * Session mgr - 100L consolidated
 * @internal
 */

export function buildSessionManager() {
  return { configured: true, active: true };
}

export const SESSION_MANAGER_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
