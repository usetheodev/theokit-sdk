# D261 — LRU eviction in-memory default `1000` entries; configurable

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Default `maxEntries: 1000`. LRU eviction (Map + recency list). API: `Cache.semantic({ maxEntries: 5000 })`. JSON disk-backed evicts on write when count > max.

## Rationale

1000 is dev/staging sweet spot (~few MB at 1536-dim float32). LRU is cheap (O(1) ops) and standard. Callers needing millions of entries use Redis/Postgres backends (v1.x).

## Consequences

- Tests cover eviction.
- Documented default size.
