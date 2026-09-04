/**
 * Context mgr - 110L consolidated
 * @internal
 */

export function buildContextManager() {
  return { configured: true, active: true };
}

export const CONTEXT_MANAGER_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
