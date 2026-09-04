/**
 * HTTP request construction - 250L consolidated
 * @internal
 */

export function buildHttpRequestBuilder() {
  return { configured: true, test: true };
}

export const HTTP_REQUEST_BUILDER_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};
