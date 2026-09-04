/**
 * Shared wire contract test helpers.
 * Consolidates 192L from wire-contract.test.ts (3 sites).
 * @internal
 */
export function buildWireContractTestCase(overrides?: Record<string, any>) {
  return {
    input: { type: "wire", data: {} },
    expectedOutput: { type: "wire", data: {} },
    ...overrides,
  };
}
