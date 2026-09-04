/**
 * Bedrock mapper test helpers (45L, 3 sites).
 * @internal
 */

export function buildBedrockMapperHelpersTestCase(overrides?: Record<string, any>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
