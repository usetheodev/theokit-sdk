# D131 — Fork inherits parent pool by reference via `withCredentialPool` AsyncLocalStorage

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`internal/llm/credential-pool-context.ts` exposes `withCredentialPool(pools, fn)` and `currentCredentialPool(provider)` — mirrors the D111 `withToolWhitelist` pattern. Forked sub-agents (`Agent.fork(...)`) inherit the parent's pool **by reference** (not a clone). Concurrent rotations observe the same cooldown state.

## Rationale

Hermes's `delegate_task` shares the parent pool with subagents (`website/.../credential-pools.md:182-190`). Reference share ensures all forks see exhaustion in unison — desired. Clone semantics would let two forks both hit a 429 on the same key independently before learning the other had already burnt it.

## Consequences

- **Enables:** Subagent rate-limit resilience inherited automatically; zero per-fork configuration.
- **Constrains:** Forked agents writing to the pool affect the parent's view — by design. Documented in JSDoc of `withCredentialPool`.
