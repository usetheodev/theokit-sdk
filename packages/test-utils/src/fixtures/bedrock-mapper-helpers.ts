/**
 * Bedrock mapper test helpers (45L, 3 sites).
 * @internal
 */

export function buildBedrockMapperHelpersTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "test-case",
    ...overrides,
  };
}
