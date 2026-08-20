/**
 * Poll a synchronous condition until it becomes true, instead of sleeping a
 * fixed duration and hoping the other async branch got there in time.
 *
 * Extracted from the inline loop already proved at
 * `agent-registry-cache.test.ts` (M77 — see the comment there for the
 * incident: a fixed 100ms wait for an LRU eviction passed alone and failed
 * 1-in-3 under full-suite load, because 100ms stops being enough when the
 * machine is busy). `rules/testing.md` § 6 lists wall-clock time in a unit
 * test as an anti-pattern; this is the shared version of the fix (B-056).
 *
 * The deadline is a safety net, not the signal: a passing run returns as
 * soon as `condition()` is true — this is never slower than the fixed sleep
 * it replaces — and a condition that genuinely never becomes true still
 * fails, with a message naming what was expected instead of a silent flake.
 *
 * @internal
 */
export async function pollUntil(
  condition: () => boolean,
  opts: { deadlineMs?: number; intervalMs?: number; message?: string } = {},
): Promise<void> {
  const deadlineMs = opts.deadlineMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 10;
  const deadline = Date.now() + deadlineMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(opts.message ?? `pollUntil: condition not met within ${deadlineMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
