# D103 — `check_fn` results TTL-cached for 30 seconds

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D102

## Decision

`isToolAvailable(entry)` caches the `entry.checkFn()` result for 30s
per tool name. `requiresEnv` is checked synchronously on every call
(no cache — env lookup is O(1)).

A `checkFn` that throws is treated as `unavailable` AND cached (same
TTL).

## Rationale

Without cache, each turn invokes the checkFn (which may be an HTTP
probe, package import, or `which git` shell call). 30s balances
freshness with perf — dev notes uninstalls within 30s; turn-rate-fire
runs don't re-probe.

EC-8: concurrent `Promise.all` may invoke checkFn N times before the
first completes — acceptable (idempotent, cache eventually stabilizes).

## Consequences

- **Enables:** tools with expensive probes (HTTP, package detection)
  stay viable.
- **Constrains:** Stale state up to 30s. Documented; not mitigated
  further (the right TTL is workload-specific).
