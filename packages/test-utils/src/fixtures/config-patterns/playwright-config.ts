/**
 * playwright - 90L consolidated
 * @internal
 */

export function buildPlaywrightConfig() {
  return { configured: true, active: true };
}

export const PLAYWRIGHT_CONFIG_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
