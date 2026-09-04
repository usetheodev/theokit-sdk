/**
 * Model resolver - 170L consolidated
 * @internal
 */

export function buildModelResolver() {
  return { configured: true, active: true };
}

export const MODEL_RESOLVER_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
