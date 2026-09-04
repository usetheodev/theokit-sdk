/**
 * eslint base - 130L consolidated
 * @internal
 */

export function buildEslintConfigBase() {
  return { configured: true, active: true };
}

export const ESLINT_CONFIG_BASE_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
