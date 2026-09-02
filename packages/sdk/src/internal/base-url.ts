/**
 * `THEOKIT_API_BASE_URL`, read in one place.
 *
 * A leaf on purpose: `internal/http.ts` resolves the SDK's endpoint from it, and so do the cloud
 * agent and `internal/agent/helpers.ts`. It used to live in `runtime/fixtures/fixture-mode.ts`,
 * which meant a production HTTP module resolved its base URL out of a module named for test
 * fixtures. `fixture-mode.ts` is now one of its four consumers rather than its owner — it needs the
 * value because an explicitly configured base URL short-circuits fixture mode.
 *
 * Nothing is imported here beyond the environment, so no consumer risks a cycle through it.
 *
 * @internal
 */

/**
 * Returns the base URL configured via `THEOKIT_API_BASE_URL`, or `undefined`
 * when not set.
 *
 * @internal
 */
export function getConfiguredBaseUrl(): string | undefined {
  const value = process.env.THEOKIT_API_BASE_URL;
  if (value === undefined || value.length === 0) return undefined;
  return value;
}
