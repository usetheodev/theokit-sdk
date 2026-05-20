# D128 — Concurrency: in-process `withCwdMutex` for reads; `withFileLock` only on writes

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Reads/selects use `withCwdMutex` (D9) keyed by `credential-pool:${provider}` — async-aware, in-process serialization. Cross-process file locking (`withFileLock` D61) is applied ONLY to writes (`saveCredentialPoolStore`). Reads do not lock.

## Rationale

The interesting race is two concurrent `agent.send()` calls in the same Node process picking the same key. `withCwdMutex` serializes that. Cross-process races (two Node processes sharing `~/.theokit/credential-pool.json`) are vanishingly rare for the SDK use case — locking every read would impose 5+ms latency for marginal protection. Writes are rare and benefit from the file lock.

## Consequences

- **Enables:** Sub-µs lock overhead per select; cross-process write safety.
- **Constrains:** Two Node processes may double-pick the same key momentarily during a race — worst case = 1 extra 429 per race. Self-corrects on next save.
