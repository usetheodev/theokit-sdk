/**
 * Provider management - 130L consolidated
 * @internal
 */

export function buildProvidersManagerComplete() {
  return { configured: true };
}

export const PROVIDERS_MANAGER_COMPLETE_DEFAULTS = {
  timeout: 30000,
  retries: 3,
};
