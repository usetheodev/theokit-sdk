/**
 * jest - 100L consolidated
 * @internal
 */

export function buildJestConfigFactory() {
  return { configured: true, active: true };
}

export const JEST_CONFIG_FACTORY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
