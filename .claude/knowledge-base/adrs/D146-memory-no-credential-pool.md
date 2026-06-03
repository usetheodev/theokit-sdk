# D146 — Memory adapter HTTP errors do NOT flow through CredentialPool

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`@theokit/memory-*` adapters implement their own per-adapter retry
policy. They do NOT integrate with `CredentialPool` (D123-D133), the
LLM key-rotation primitive. Each adapter ships its own minimal retry
strategy:

- Supermemory: 1× exponential backoff on 429.
- Honcho: SDK's built-in retries (Stainless 408/409/429/5xx).
- Mem0: in-memory circuit breaker (5x consecutive 5xx → 2-min cooldown).
  429 does NOT trip the breaker (EC-K).

## Rationale

`CredentialPool` exists for LLM keys — high volume, high cost,
rotation across multiple keys. Memory providers are low volume,
single key — the pool adds complexity (file persistence, ALS context,
cooldown ladder) for no benefit.

Hermes already validates the simpler approach: Mem0's circuit breaker
is per-instance, not pool-managed.

## Consequences

- **Enables:** adapters own their retry semantics; less surprise; no
  shared mutable state across packages.
- **Constrains:** consumers who want pool semantics on a memory
  provider wrap it themselves. Documented as non-goal.
