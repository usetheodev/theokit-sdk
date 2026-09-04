/**
 * @theokit/shared-test-config — Shared test infrastructure and factories
 *
 * Consolidates duplicated configuration files across all Theo test packages.
 * Part of duplicate-code remediation (DUPLICATION_REMEDIATION_STRATEGY.md).
 *
 * Exports:
 * - `createVitestConfig()` — vitest config factory for all packages
 *
 * @internal
 */

export * from "./tsup.js";
export * from "./vitest.js";
