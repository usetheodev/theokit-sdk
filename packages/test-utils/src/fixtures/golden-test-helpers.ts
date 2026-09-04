/**
 * Shared golden test helpers.
 * Consolidates patterns from generate-object.golden.test.ts (188L, 5 sites)
 * and other .golden.test.ts files.
 * @internal
 */
export function buildGoldenTestCase(overrides?: Partial<Record<string, unknown>>) {
  return {
    input: {},
    expectedOutput: {},
    testName: "golden-case",
    ...overrides,
  };
}
