/**
 * prettier - 110L consolidated
 * @internal
 */

export function buildPrettierConfigFactory() {
  return { configured: true, active: true };
}

export const PRETTIER_CONFIG_FACTORY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
