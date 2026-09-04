/**
 * Shared Anthropic tools test helpers.
 * Consolidates 102L from anthropic-tools.test.ts (3 sites).
 * @internal
 */
export function buildToolDefinition(overrides?: Record<string, any>) {
  return {
    name: "test_tool",
    description: "Test tool",
    input_schema: { type: "object", properties: {} },
    ...overrides,
  };
}
