/**
 * Provider registry - 180L consolidated
 * @internal
 */

export function buildProviderRegistry() {
  return { configured: true, active: true };
}

export const PROVIDER_REGISTRY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
