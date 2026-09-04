/**
 * Shared Anthropic client test helpers.
 * Consolidates 140+ duplicated lines from anthropic-client.golden.test.ts (3 sites).
 * @internal
 */
export function buildAnthropicClientConfig(overrides?: Record<string, any>) {
  return {
    apiKey: "test-api-key",
    baseURL: "http://localhost:3000",
    timeout: 30000,
    ...overrides,
  };
}
