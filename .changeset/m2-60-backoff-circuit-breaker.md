---
"@theokit/sdk": minor
---

The credential pool now backs off before retrying a rate-limited key and trips a circuit breaker when a provider is down (#60). On the first 429 the pool used to re-hit the same key immediately (a `continue` with no sleep), burning every retry in under a millisecond under a shared-quota storm; it now sleeps a full-jitter backoff (`computeBackoffMs` + `sleepWithAbort`, already in-tree, now wired) before the same-key retry. A consecutive-failure circuit breaker (relocated to a neutral `internal/resilience/` module and shared with Active Memory) guards each provider: after N consecutive whole-attempt failures the pool fails fast with a typed `NetworkError` (`code: "circuit_open"`) until a cooldown elapses, instead of re-running the whole select→retry→rotate dance against a provider that is down. All stdlib — no new dependency. Existing name-only behavior and the provider's `Retry-After` cooldown on the rotate path are unchanged.
