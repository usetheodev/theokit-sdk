/**
 * Ordered, bounded-concurrency parallel map (plan m0-foundation-expose-primitives, M0-2).
 *
 * Runs `fn` over `items` with at most `concurrency` invocations in flight at
 * once, preserving input order in the result array. Fail-fast: rejects with the
 * first error a task throws (matching the in-house `boundedParallel`/`runBatches`
 * clones this consolidates). Backed by the in-house {@link createSemaphore}
 * (ADR D135 — no `p-limit`/`p-map` dependency).
 *
 * @internal — public via `@theokit/sdk/concurrency`
 */

import { createSemaphore } from "./async-semaphore.js";

const NEVER_ABORT: AbortSignal = new AbortController().signal;

/**
 * Map `fn` over `items` with bounded concurrency, preserving order.
 *
 * @param items - inputs to process
 * @param concurrency - max in-flight invocations (positive integer; validated)
 * @param fn - async mapper; receives the item, its index, and an abort signal
 * @param options.signal - optional abort signal; once aborted, no new `fn`
 *   invocation is started (in-flight ones are not force-cancelled)
 * @returns results in the same order as `items`
 * @throws ConfigurationError when `concurrency` is not a positive integer
 *
 * @example
 *   await mapWithConcurrency([1, 2, 3], 2, async (n) => n * 2); // [2, 4, 6]
 */
export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  options?: { signal?: AbortSignal },
): Promise<R[]> {
  const semaphore = createSemaphore(concurrency);
  const signal = options?.signal ?? NEVER_ABORT;
  return Promise.all(
    items.map(async (item, index) => {
      const release = await semaphore.acquire();
      try {
        if (signal.aborted) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new Error("mapWithConcurrency: aborted");
        }
        return await fn(item, index, signal);
      } finally {
        release();
      }
    }),
  );
}
