/**
 * Shared config.json test helpers.
 * Consolidates 616+ duplicated lines from config-json-supplies-the-default-compat-sources.test.ts (5 sites).
 * @internal
 */
export function buildConfigJson(overrides?: Partial<Record<string, unknown>>) {
  return {
    sources: ["default"],
    compat: true,
    ...overrides,
  };
}
