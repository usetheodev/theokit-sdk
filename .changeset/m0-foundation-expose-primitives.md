---
"@theokit/sdk": minor
---

M0 Foundation — expose already-existing internal primitives as public surfaces (plan `m0-foundation-expose-primitives`), so agent/code-assistant builders reuse battle-tested plumbing instead of re-implementing it.

- `isTransientError(err)` — public retryability predicate delegating to `TheokitAgentError.isRetryable` (T1.1).
- `safeFilenameForId(id, { maxLen })` — total id→filename helper via `@theokit/sdk/path-safety` (passthrough when safe, deterministic sha256 token otherwise); `sanitizeRunId` migrated to it (T2.1).
- `@theokit/sdk/concurrency` — public `createSemaphore` + new ordered, fail-fast `mapWithConcurrency`; two internal pooling clones deduplicated onto it (T3.1).
- `@theokit/sdk/retry` — generic `withRetry(fn, options)` (exponential backoff + full jitter, injectable sleep/rng, default `isRetryable = isTransientError`) (T4.1).
- `openSqliteResilient` (`@theokit/sdk/internal/persistence`, semver-exempt) — shared driver-load + WAL + corruption-recovery; both memory `index-db` copies deduplicated onto it (T5.1).
