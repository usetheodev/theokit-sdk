# D265 — Persistence: in-memory default; JSON disk opt-in via `persistence: { dir }`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Default `InMemoryCacheStore` (Map + LRU). Opt-in `persistence: { backend: "json", dir: ".theokit/cache" }` uses `atomicWriteText` (D60) + versioned read (D62). One file per namespace.

## Rationale

Most caches are in-process; disk-backed is opt-in for surviving restarts. Pattern mirrors D235 (workflows). SQLite/Redis backends ship in v1.x via `WorkflowSnapshotStore`-style adapter pattern.

## Consequences

- Tests cover both in-memory and JSON.
- Schema versioning protects upgrades.
- Corrupt JSON file treated as empty cache (EC-7).
