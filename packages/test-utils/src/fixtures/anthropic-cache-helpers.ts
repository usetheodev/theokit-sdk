/**
 * Anthropic cache test helpers (51L, 3 sites).
 * @internal
 */

export function buildAnthropicCacheHelpersTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
