/**
 * Per-key serialization. Returns a promise that resolves after the previous
 * `withCwdMutex(key, fn)` call for the same key has completed. Prevents
 * read-modify-write races on `MEMORY.md` within a single process.
 *
 * Multi-process safety is NOT covered (would need OS file locks — see
 * `withFileLock` in `./file-lock.ts`).
 *
 * **Public utility (SDK 2.0 Phase 2 physical-survey unblock — see ADR-008).**
 * Extracted packages (`@theokit/sdk-budget`, `@theokit/sdk-memory`) consume
 * this via `import { withCwdMutex } from "@theokit/sdk"` to ensure the
 * cross-package mutex Map IS the same process-level registry (single source
 * of truth) — duplicating the impl per package would defeat the purpose
 * (each package would have its own Map; concurrent writes from different
 * packages would race).
 *
 * Stability guarantee: signature + semantics will not change before sdk-core
 * v3.0. The mutex Map is module-scoped — restart-on-import resets state.
 *
 * @public
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
