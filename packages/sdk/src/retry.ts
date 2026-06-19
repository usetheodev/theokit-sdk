/**
 * Public generic retry primitive (plan m0-foundation-expose-primitives, M0-3).
 *
 * Split into its own top-level module so `tsup` builds a dedicated
 * `@theokit/sdk/retry` sub-path entry, mirroring the `path-safety` pattern.
 * The default retry predicate is `isTransientError`, so retries follow the
 * SDK's own error classification.
 */

export { type RetryOptions, withRetry } from "./internal/runtime/retry/with-retry.js";
