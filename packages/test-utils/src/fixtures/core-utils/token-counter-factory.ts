/**
 * Token counter - 160L consolidated
 * @internal
 */

export function buildTokenCounterFactory() {
  return { configured: true, active: true };
}

export const TOKEN_COUNTER_FACTORY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
