---
"@theokit/sdk": minor
---

M0 Foundation — expose already-existing internal primitives as public surfaces (plan `m0-foundation-expose-primitives`), so agent/code-assistant builders reuse battle-tested plumbing instead of re-implementing it.

- `isTransientError(err)` — public retryability predicate delegating to `TheokitAgentError.isRetryable` (T1.1).
