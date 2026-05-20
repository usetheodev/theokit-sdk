/**
 * Per-key serialization. Returns a promise that resolves after the previous
 * `withCwdMutex(key, fn)` call for the same key has completed. Prevents
 * read-modify-write races on `MEMORY.md` within a single process.
 *
 * Multi-process safety is NOT covered (would need OS file locks — see
 * `withFileLock` in `./file-lock.ts`).
 *
 * @internal
 */
const tails = new Map<string, Promise<unknown>>();

export function withCwdMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run fn whether prev fulfilled or rejected
  // Save the new tail. Store the .then() chain that swallows the result so a
  // failure here doesn't poison subsequent waiters.
  tails.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}
