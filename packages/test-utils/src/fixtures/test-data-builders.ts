/**
 * Test data builders — factory functions for creating test objects.
 * Consolidates duplicated fixture builders from all Theo test suites.
 *
 * Part of duplicate-code remediation Phase 1.
 * Builders follow the pattern: `build<Type>(overrides?)`.
 *
 * @internal
 */

/**
 * Consolidated custom tool for tests.
 * Consolidates duplicated SEARCH_DOCS / TEST_TOOL patterns across SDK tests.
 */
export function buildCustomTool(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "search_docs",
    description: "Search the documentation",
    inputSchema: {
      type: "object" as const,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    handler: () => "results",
    ...overrides,
  };
}

/**
 * Consolidated Agent creation options for tests.
 * Consolidates repeated Agent.create({ apiKey, model, ... }) patterns.
 */
export function buildAgentOptions(overrides?: Partial<Record<string, unknown>>) {
  return {
    apiKey: "theo_test_agent",
    model: { id: "claude-sonnet-4-6" },
    ...overrides,
  };
}

/**
 * Consolidated logger configuration for tests.
 * Consolidates console/no-op logger setup repeated across test suites.
 */
export function buildTestLogger(overrides?: Partial<Record<string, unknown>>) {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    ...overrides,
  };
}

/**
 * Consolidated runtime config for OpenAI-compatible services.
 * Consolidates repeated CONFIG / RUNTIME_CONFIG patterns.
 */
export function buildRuntimeConfig(overrides?: Partial<Record<string, unknown>>) {
  return {
    baseURL: "http://localhost:8000/v1",
    apiKey: "test-key",
    model: "gpt-4-turbo",
    ...overrides,
  };
}
