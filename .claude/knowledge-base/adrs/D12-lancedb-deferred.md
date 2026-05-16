---
id: D12
status: Decided
date: 2026-05-16
plan: sdk-v1-ga-completion
---

# D12 — LanceDB backend deferred to v1.1

## Context
OpenClaw's `memory-lancedb` extension swaps SQLite-vec for LanceDB without changing the public tool surface. The previous SDK iteration registered `"lancedb"` as a backend that threw `memory_backend_not_implemented`. Under the no-stubs rule, the throw was removed and the union narrowed.

## Decision
v1.0 ships `MemoryBackend = "sqlite-vec"` only. LanceDB is deferred to v1.1.

## Rationale
- SQLite-vec ships and is sufficient for v1.0 scale (≤100k chunks).
- LanceDB's advantages (HNSW-grade vector search, columnar storage) matter at >1M chunks — outside v1.0's audience.
- Adding LanceDB pulls `@lancedb/lancedb` (non-trivial native dep, larger binary, platform-specific prebuilds) for users who don't need it.
- The `IndexManager.open` contract is extensible — v1.1 can add `"lancedb"` to the union without breaking v1.0 consumers.

## Consequences
- `MemoryBackend` union is `"sqlite-vec"` only.
- `@lancedb/lancedb` is NOT in `tsup.config.ts` externals.
- The deferral ADR documents what v1.1 must include: real adapter + benchmark proving the scale rationale.

## Alternatives Considered
- **Implement now** — rejected; effort high, demand low at v1.0 scale.
- **Keep as a throwing stub** — rejected; violates no-stubs rule.
