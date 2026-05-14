/**
 * Single source of truth for "what marks a value as still carrying public
 * contract signal after normalization". Used by:
 *
 * - {@link assertGoldenHasContractSignal} in `normalize.ts` (runtime guard
 *   inside individual golden tests)
 * - The hygiene golden test (`hygiene.golden.test.ts`) when scanning every
 *   `*.json` in `tests/golden/`
 *
 * Keep both call sites in lock-step by importing this list — never duplicate
 * the literal array.
 */
export const CONTRACT_SIGNAL_FIELDS = [
  '"agentId"',
  '"agent_id"',
  '"apiKeyName"',
  '"capability"',
  '"code"',
  '"cron"',
  '"id"',
  '"name"',
  '"provider"',
  '"role"',
  '"run_id"',
  '"runtime"',
  '"status"',
  '"type"',
  '"url"',
] as const;

/**
 * Returns true when the JSON form of `value` contains at least one of the
 * recognized public contract fields.
 */
export function hasContractSignal(value: unknown): boolean {
  const text = JSON.stringify(value);
  return CONTRACT_SIGNAL_FIELDS.some((field) => text.includes(field));
}
