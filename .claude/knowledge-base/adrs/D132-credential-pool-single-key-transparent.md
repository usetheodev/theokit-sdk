# D132 — Single-key shape (`apiKey: "..."`) takes the no-pool fast path

**Date:** 2026-05-20
**Status:** Accepted

## Decision

When `AgentOptions.apiKey` is a single string AND `providers.apiKeys` is unset OR empty, the router skips pool wrapping entirely (`buildClient` returns the underlying `LlmClient` directly). No `PoolAwareLlmClient` allocated, no mutex acquired, no persistence touched.

When `providers.apiKeys[name]` has ≥2 effective keys, the router wraps in `PoolAwareLlmClient`. Exactly 1 effective key in `apiKeys` also takes the fast path — pooling 1 key is wasted overhead.

## Rationale

Backward compatibility is load-bearing. The existing 95% of callers pass `apiKey: "..."` once and never touch pools. They shouldn't pay the mutex / file-lock / debounce overhead. Pool wrap activates only when the caller explicitly opts in via `apiKeys: { provider: [a, b, ...] }`.

## Consequences

- **Enables:** Zero-overhead default path; opt-in pool semantics for callers who actually have multiple keys.
- **Constrains:** A user who later wants to add a second key must migrate from `apiKey: "k1"` to `apiKeys: { provider: ["k1", "k2"] }` — documented as the upgrade path in `docs.md`.
