/**
 * Test-only re-export of the redact module's reset helper. Used by
 * `packages/sdk/vitest.setup.ts:beforeEach` to clear user-added patterns
 * between tests (EC-3 fix from the secret-redaction-discipline plan
 * edge-case review). NOT included in `index.ts` barrel — keep production
 * callers from accidentally importing it.
 *
 * @internal
 */

export { _resetForTests } from "./redact.js";
