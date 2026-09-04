/**
 * vitest preset - 140L consolidated
 * @internal
 */

export function buildVitestConfigPreset() {
  return { configured: true, active: true };
}

export const VITEST_CONFIG_PRESET_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
