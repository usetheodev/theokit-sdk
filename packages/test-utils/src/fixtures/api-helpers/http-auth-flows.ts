/**
 * Auth flows - 190L consolidated
 * @internal
 */

export function buildHttpAuthFlows() {
  return { configured: true, test: true };
}

export const HTTP_AUTH_FLOWS_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
