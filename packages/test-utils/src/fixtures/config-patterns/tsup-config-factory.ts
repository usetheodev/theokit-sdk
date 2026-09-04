/**
 * tsup factory - 150L consolidated
 * @internal
 */

export function buildTsupConfigFactory() {
  return { configured: true, active: true };
}

export const TSUP_CONFIG_FACTORY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
