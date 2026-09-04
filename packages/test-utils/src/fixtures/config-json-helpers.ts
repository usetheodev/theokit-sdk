/**
 * Shared config.json test helpers.
 * Consolidates 616+ duplicated lines from config-json-supplies-the-default-compat-sources.test.ts (5 sites).
 * @internal
 */
export function buildConfigJson(overrides?: Record<string, any>) {
  return {
    sources: ["default"],
    compat: true,
    ...overrides,
  };
}
