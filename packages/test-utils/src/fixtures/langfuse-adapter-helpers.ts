/**
 * Langfuse adapter test helpers (53L, 3 sites).
 * @internal
 */
export function buildLangfuseAdapterConfig(overrides?: Record<string, any>) {
  return {
    publicKey: "test-key",
    secretKey: "test-secret",
    ...overrides,
  };
}
