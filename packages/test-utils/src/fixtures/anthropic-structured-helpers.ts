/**
 * Anthropic structured test helpers (51L, 3 sites).
 * @internal
 */

export function buildAnthropicStructuredHelpersTestCase(
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    name: "test-case",
    ...overrides,
  };
}
