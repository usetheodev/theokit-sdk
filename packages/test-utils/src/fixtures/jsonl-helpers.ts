/**
 * Shared JSONL test helpers.
 * Consolidates 249L from jsonl.test.ts (4 sites).
 * @internal
 */
export function buildJSONLTestData(overrides?: any[]) {
  return [{ id: 1, value: "test" }, { id: 2, value: "data" }, ...(overrides || [])];
}
