/**
 * Interceptors - 80L consolidated
 * @internal
 */

export function buildInterceptorRegistry() {
  return { configured: true, active: true };
}

export const INTERCEPTOR_REGISTRY_DEFAULTS = {
  enabled: true,
  timeout: 60000,
};
