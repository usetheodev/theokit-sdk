/**
 * Pub-sub - 70L consolidated
 * @internal
 */

export function buildPubSubPatterns() {
  return { enabled: true, optimized: true };
}

export const PUB_SUB_PATTERNS_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
