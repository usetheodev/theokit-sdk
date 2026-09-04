/**
 * Test fixtures — shared data, builders, and test data factories.
 *
 * Consolidates duplicated fixtures from all Theo test suites.
 * Part of duplicate-code remediation Phase 1 (test fixtures = 2,543 findings).
 *
 * Exports:
 * - `useTempDirectory()` — vitest beforeEach/afterEach helper for temp dirs
 * - `buildCustomTool()`, `buildAgentOptions()`, etc. — test data builders
 *
 * @internal
 */

export * from "./temp-directory.js";
export * from "./test-data-builders.js";
