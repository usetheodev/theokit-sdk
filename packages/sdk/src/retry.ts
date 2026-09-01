/**
 * Public generic retry primitive (plan m0-foundation-expose-primitives, M0-3).
 *
 * Split into its own top-level module so `tsup` builds a dedicated
 * `@theokit/sdk/retry` sub-path entry, mirroring the `path-safety` pattern.
 * The default retry predicate is `isTransientError`, so retries follow the
 * SDK's own error classification.
 */

import { type RetryOptions, withRetry } from "./internal/retry/with-retry.js";

export type { RetryOptions };

/**
 * SE36 — `Retry.create` replaces `withRetry` (ADR 0015 / ADR-P2). NOTE: `withRetry` is an
 * EXECUTOR, not a constructor — `Retry.create(fn, opts)` RUNS `fn` with retry and resolves to
 * its result (`Promise<T>`), not a `Retry` instance. The `.create` name is the uniformity
 * mandate; the executor semantics are the documented, accepted awkwardness. @public
 */
export class Retry {
  private constructor() {}
  static create<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
    return withRetry(fn, options);
  }
}
