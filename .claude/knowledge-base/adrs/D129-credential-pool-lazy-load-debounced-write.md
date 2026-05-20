# D129 — Persistence: lazy load on first use, debounced write (200 ms)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`loadCredentialPoolStore(cwd)` is called once at the agent's first pool-touching code path (not on `Agent.create()`). Writes happen via `DebouncedPoolSaver.schedule()` — a `setTimeout(saveStore, 200)` that is cleared and rescheduled on every state mutation. EC-E: only one pending timeout at a time.

## Rationale

Cold-start cost matters when pools aren't even used — lazy load defers a 5 ms disk-read. Debounce batches rapid request-count updates from `least_used` strategy — `fsync` per call would dominate runtime for high-rate workloads. 200 ms compromise: human-visible delay is imperceptible; process-crash window is small (lost increment is advisory, not state-critical).

## Consequences

- **Enables:** Zero cold-start cost when no pool wiring; sub-1% write amplification under heavy `least_used` workload.
- **Constrains:** Process killed within 200 ms of mutation loses the pending `requestCount` delta. Counts are advisory only — `least_used` re-balances within 1-2 selects after restart.
