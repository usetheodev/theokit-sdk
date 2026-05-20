# D138 — Each batch prompt gets a fresh agent; credential pool shared via ALS

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`Agent.batch` creates a fresh `SDKAgent` per prompt (`create → send →
wait → dispose`) — mirroring `Agent.prompt`'s lifecycle. Each agent has
its own session id, its own LocalAgent send-mutex, its own internal
state.

**Credential pool is the exception.** When `options.providers.apiKeys`
defines ≥2 keys for any provider, `batchImpl` constructs the
`CredentialPool` instances ONCE and wraps the entire batch in
`withCredentialPool(pools, ...)` (AsyncLocalStorage). Inside the
scope, `router.ts:buildClient` consults `currentCredentialPool(name)`
first and reuses the ambient pool instead of constructing a fresh one
from the same `apiKeys`.

## Rationale

Per-prompt isolation is the safe default: no shared session state
means no memory bleed between prompts, no cross-prompt serialization
on the LocalAgent send-mutex, and each agent disposes cleanly.

The credential pool, however, must be shared. Without ALS, every
`Agent.create()` inside the batch would build its own
`CredentialPool` from identical `apiKeys`, producing N independent
pools. Each pool would have to learn separately that a given key was
rate-limited — meaning a single 429 propagates as 4 cooldowns instead
of 1, wasting 3× the rate-limit budget per concurrency window.

Mirrors the same ALS pattern used by `fork-agent` (D131) for
parent → child pool inheritance.

### EC-A wire verification

`router.ts:buildClient` now starts with:

```ts
const ambient = currentCredentialPool(name);
if (ambient !== undefined) {
  return new PoolAwareLlmClient(ambient, ...);
}
```

Confirmed by integration test
(`tests/integration/batch-with-pool.test.ts`) and by batch unit test
`EC-A: shares credential pool across concurrent batch agents`, which
asserts the SAME pool reference is observed from inside two parallel
agent factories.

## Consequences

- **Enables:** clean session isolation + single pool instance per
  provider across the batch (one 429 → all in-flight learn it).
- **Constrains:** ~5ms per-agent creation overhead × N prompts.
  Negligible at the typical 100-1000 prompt scale (≤5s overhead
  total). For latency-sensitive use cases below 50ms-per-prompt, the
  caller should reach for `agent.send()` on a single warm agent
  instead — `Agent.batch` is a throughput primitive, not a latency
  primitive.
