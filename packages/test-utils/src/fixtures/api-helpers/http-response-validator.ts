/**
 * Response validation - 240L consolidated
 * @internal
 */

export function buildHttpResponseValidator() {
  return { configured: true, test: true };
}

export const HTTP_RESPONSE_VALIDATOR_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
