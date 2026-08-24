// Tail of the queue per key. Module-scoped on purpose — see `withCwdMutex` below, which is where
// the contract is documented. Entries are never removed, so the Map holds one promise per distinct
// key for the life of the process; keys are expected to come from a bounded set (a file path, a
// subsystem name), not from unbounded user input.
const tails = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after every earlier `withCwdMutex` call for the same `key` has settled, and return
 * what `fn` returns.
 *
 * Calls with the same key run strictly in the order they were made — FIFO, never concurrent.
 * Calls with different keys never wait on each other. The key is an opaque string: two callers
 * serialize against each other exactly when they pass equal keys, so a shared key IS the
 * contract, and a mismatched one silently buys no protection at all.
 *
 * A rejection does not poison the queue. The next waiter runs whether the previous `fn` fulfilled
 * or rejected, and the rejection is delivered only to the caller whose `fn` threw. This function
 * neither retries nor swallows: the returned promise rejects with whatever `fn` rejected with.
 *
 * There is no timeout and no cancellation. An `fn` that never settles blocks that key for the
 * lifetime of the process.
 *
 * **Scope — this is an in-process lock only.** State is a module-scoped Map, so it serializes
 * callers that share one module instance and nothing else. Two processes, two worker threads, or
 * two copies of the SDK resolved into the same tree do not see each other's queue. When the
 * resource is a file that other processes can also write, use `withFileLock` from
 * `./file-lock.ts` instead — it takes an OS-level lock and layers this mutex underneath, so it
 * gives both guarantees. Reach for `withCwdMutex` directly when the shared state is in memory, or
 * when the file is one only this process touches.
 *
 * Extracted packages (`@theokit/sdk-budget`, `@theokit/sdk-memory`) import this from
 * `@theokit/sdk` rather than reimplementing it, precisely so the Map is the same one: a per-package
 * copy would give each package its own queue and let their writes race.
 *
 * The Map is module-scoped, so nothing survives a process restart or a fresh module instance, and
 * its entries are never removed — pass keys from a bounded set rather than from arbitrary input.
 * Signature and semantics will not change before sdk-core v3.0.
 *
 * @public
 */
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
