# D125 — Cooldown ladder: 401→5min, 429→1h, 402→1h; provider `Retry-After` overrides

**Date:** 2026-05-20
**Status:** Accepted

## Decision

| HTTP code | Cooldown | Override |
|---|---|---|
| 401 | 5 min | provider `resetAt`/`retryAfter` |
| 402 | 1 h | provider `resetAt`/`retryAfter` |
| 429 | 1 h | provider `resetAt`/`retryAfter` |
| other | 1 h (default) | provider `resetAt`/`retryAfter` |

Provider-supplied hints (numeric `retry-after` in `error.metadata.retryAfter` seconds) always override defaults.

## Rationale

Mirrors Hermes constants (`EXHAUSTED_TTL_401_SECONDS=300`, `_429=3600`, `_DEFAULT=3600`). 401 short because OAuth refresh can recover within minutes; 429/402 long because rate-limit windows are typically hourly. Provider hint wins — they know best when the key resumes.

## Consequences

- **Enables:** Self-healing pool without manual reset; provider-aware backoff.
- **Constrains:** A misbehaving provider that returns 429 for non-transient errors holds the entry for an hour — caller uses `pool.resetAll()` escape hatch.
