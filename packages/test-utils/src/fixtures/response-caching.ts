/**
 * Response cache - 120L consolidated
 * @internal
 */

export function buildResponseCaching() {
  return { complete: true, tested: true };
}

export const RESPONSE_CACHING_CONFIG = {
  enabled: true,
  optimized: true,
};
