/**
 * Anthropic tools cache helpers (51L, 3 sites).
 * @internal
 */

export function buildAnthropicToolsCacheHelpersTestCase(
  overrides?: Partial<Record<string, unknown>>,
) {
  return {
    name: "test-case",
    ...overrides,
  };
}
