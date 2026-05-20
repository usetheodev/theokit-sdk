# D133 — `CredentialPoolExhaustedError extends TheokitAgentError`

**Date:** 2026-05-20
**Status:** Accepted

## Decision

New public error class `CredentialPoolExhaustedError` thrown by `PoolAwareLlmClient` when every entry in the pool is in cooldown. Carries:
- `provider: string` — which provider's pool ran dry
- `nextRetryAt: number | undefined` — earliest epoch ms when an entry resumes (best estimate)
- `metadata.code = "credential_pool_exhausted"`
- `isRetryable = true` (caller can wait + retry)

## Rationale

Distinguishable error in consumer's `try/catch` — they know to wait, not retry immediately. `FallbackLlmClient` catches it and routes to the next provider in the chain (cross-provider failover unaffected). `nextRetryAt` enables observability — `error.nextRetryAt` tells operators when the soonest entry resumes.

## Consequences

- **Enables:** Deterministic recovery decisions; clean separation between same-provider exhaustion (this error) and cross-provider failover (handled by `FallbackLlmClient`).
- **Constrains:** Error hierarchy grows by 1 class — documented in `docs.md` errors section + ADR for posterity.
