/**
 * Runs `fn` under a specific `umask` and restores the previous one — always, even on failure.
 *
 * `umask` is PROCESS state, and this package's suite runs in a single fork
 * (`vitest.config.ts`: `singleFork: true`), so leaking one contaminates every test that creates a
 * file afterwards. The `finally` is the whole point of the helper.
 *
 * One home, sync and async both. It existed twice — an async copy in
 * `internal/persistence/atomic-write-json.test.ts` and a sync one in `transcript-ops.test.ts` — each
 * carrying the same load-bearing rationale, written out at length in one and abbreviated in the
 * other. If the restore policy ever changes it should change once. The overload widening is the same
 * one `tests/helpers/poll-until.ts` already made, for the same reason.
 */
export function withUmask<T>(mask: number, fn: () => T): T;
export function withUmask<T>(mask: number, fn: () => Promise<T>): Promise<T>;
export function withUmask<T>(mask: number, fn: () => T | Promise<T>): T | Promise<T> {
  const previous = process.umask(mask);
  let settled = false;
  try {
    const out = fn();
    if (out instanceof Promise) {
      settled = true;
      return out.finally(() => {
        process.umask(previous);
      });
    }
    return out;
  } finally {
    // Only when the sync path ran: an async `fn` restores in its own `.finally` above, and doing it
    // here as well would put the umask back BEFORE the awaited work has run.
    if (!settled) process.umask(previous);
  }
}
