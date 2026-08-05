---
"@theokit/sdk": patch
"@theokit/sdk-memory": minor
---

`@theokit/sdk-memory` now uses the SDK's embedding runtime instead of its own copy (theokit#160).

The two packages each carried a full copy of `createOpenAiCompatibleRuntime`, and the satellite's
catalog replaces the SDK's at runtime when installed — so the copy that ran was not the copy most
people read. That duplication is what produced the two-month adapter gap fixed in theokit#128, and
every fix since had to be applied to both files by hand.

There is now one implementation, imported from `@theokit/sdk/internal/memory-adapters` — a
semver-exempt sub-path in the same family as `internal/persistence` and `internal/security`, which
exist for exactly this reason.

**Behaviour change for `@theokit/sdk-memory` consumers:** embedding batches now run with bounded
parallelism instead of serially, and the embedding cache is process-wide instead of per-adapter.
Both are what the SDK already did; the satellite had silently missed both improvements.
