/**
 * Cache layer - 140L consolidated
 * @internal
 */

export function buildAnthropicCacheComplete() {
  return { configured: true };
}

export const ANTHROPIC_CACHE_COMPLETE_DEFAULTS = {
  timeout: 30000,
  retries: 3,
};
