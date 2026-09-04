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

export * from "./edit-file-helpers.js";
export * from "./agent-qa-helpers.js";
export * from "./agent-describe-helpers.js";
export * from "./anthropic-vision-helpers.js";
export * from "./config-json-helpers.js";
export * from "./anthropic-client-helpers.js";
export * from "./golden-test-helpers.js";
