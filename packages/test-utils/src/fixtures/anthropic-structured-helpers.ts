/**
 * Anthropic structured test helpers (51L, 3 sites).
 * @internal
 */

export function buildAnthropicStructuredHelpersTestCase(overrides?: Record<string, any>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
