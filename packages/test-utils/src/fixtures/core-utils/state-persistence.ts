/**
 * State persist - 90L consolidated
 * @internal
 */

export function buildStatePersistence() {
  return { configured: true, active: true };
}

export const STATE_PERSISTENCE_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
