/**
 * Anthropic cache test helpers (51L, 3 sites).
 * @internal
 */

export function buildAnthropicCacheHelpersTestCase(overrides?: Record<string, any>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
