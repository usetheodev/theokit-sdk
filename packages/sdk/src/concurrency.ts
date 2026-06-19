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

export {
  type AsyncSemaphore,
  createSemaphore,
} from "./internal/runtime/concurrency/async-semaphore.js";
export { mapWithConcurrency } from "./internal/runtime/concurrency/map-with-concurrency.js";
