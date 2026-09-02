/**
 * Public concurrency primitives (plan m0-foundation-expose-primitives, M0-2).
 *
 * Thin re-export of the in-house concurrency helpers (ADR D135 — no
 * `p-limit`/`p-map` dependency). Split into its own top-level module so
 * `tsup` builds a dedicated `@theokit/sdk/concurrency` sub-path entry,
 * mirroring the `path-safety` pattern.
 *
 *   - `createSemaphore(permits)` — N-permit async-aware counting semaphore.
 *   - `mapWithConcurrency(items, concurrency, fn, opts?)` — ordered bounded map.
 */

import { type AsyncSemaphore, createSemaphore } from "./internal/concurrency/async-semaphore.js";

export type { AsyncSemaphore };

/** SE36 — `Semaphore.create` replaces `createSemaphore` (ADR 0015). @public  *
 * `Semaphore.create` returns an **`AsyncSemaphore`** — the class is the namespace and
 * `AsyncSemaphore` is the type callers hold.
 */
export class Semaphore {
  private constructor() {}
  static create(permits: number): AsyncSemaphore {
    return createSemaphore(permits);
  }
}
export { mapWithConcurrency } from "./internal/concurrency/map-with-concurrency.js";
