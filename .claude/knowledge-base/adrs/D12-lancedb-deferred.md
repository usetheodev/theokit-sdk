---
id: D12
status: Superseded by D43 — shipped in v1.4.0 (2026-05-31)
date: 2026-05-16
updated: 2026-05-31
plan: sdk-v1-ga-completion
supersededBy: D43
shippedIn: "@usetheo/sdk@1.4.0"
shippedPlan: lancedb-backend-ship-v1-1
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

---

## Update 2026-05-31 — Superseded by D43, Shipped in v1.4.0

D12 originally deferred LanceDB to v1.1. ADR D43 (2026-05-17) committed to shipping. The implementation existed in `internal/memory/lance-index.ts` from 2026-05-17 onwards but was **not wired** through `IndexManager.open` until commit `<TBD>` (2026-05-31).

**Status:** Superseded by D43.

**Shipped in:** `@usetheo/sdk@1.4.0`.

**What landed (`lancedb-backend-ship-v1-1` plan):**
- `MemoryIndex` interface formal in `internal/memory/memory-index.ts` — IndexManager + LanceMemoryAdapter both implement it.
- `IndexManager.open` factory dispatcher routes `{ backend: "lance" }` to `LanceMemoryAdapter` wrapping `LanceIndex`. SQLite default preserved byte-identical.
- `@lancedb/lancedb` as optional `peerDependency` (`^0.30.0`) + tsup external + preflight integration with EC-2 sentinel encoding (peers-probed list in filename).
- 13 env-gated integration tests (`LANCE_E2E=1`) covering add/recall/dim-mismatch/scope filter/source filter/concurrent open/EC-1 injection protection.
- `examples/memory-lance/` with dry-run default + real-mode (validated end-to-end with real Lance install).
- Benchmark numerical evidence in `.claude/knowledge-base/benchmarks/memory-backends-2026-05-31.md`.

**Benchmark evidence (refines the D43 rationale honestly):**

| Backend | Size | addFact ops/s | recall p95 (ms) | Disk (MB) |
|---|---|---:|---:|---:|
| sqlite-vec | 1k | 2697 | 0.93 | 4.9 |
| lance | 1k | 24600 | 4.58 | 0.3 |
| sqlite-vec | 100k | 1875 | 22.75 | 93.5 |
| lance | 100k | 59849 | 41.66 | 33.8 |

**Honest interpretation:** D43 originally claimed "Lance ganha em latency above 10k facts". The numbers show that's INCOMPLETE — Lance wins decisively on **ingest throughput** (43x faster at 100k) and **disk footprint** (65% smaller), but SQLite-vec's recall p95 stays competitive up to 100k. The opt-in recommendation should be reframed: **use Lance when ingest velocity or disk pressure matter; SQLite-vec covers recall latency well below 1M facts.** The `examples/memory-lance/README.md` "When to use Lance vs SQLite" table reflects this.

**Lessons:**
- ADR "deferred" status without an owner/deadline lets implementations rot (D43 shipped the code but never the wiring).
- "Implemented but not wired" violates `no-stubs-no-mocks-no-wired.md` rule 3 — caught by recon 2026-05-31, fixed via dispatcher in `IndexManager.open`.
- Benchmarks > folklore. D43's "latency wins at 10k" was partially wrong; only running the bench surfaced the real story.
- Real integration tests catch real API drift — running with `@lancedb/lancedb@0.30.0` revealed `.where()` accepts SQL string only (not object filter — D43's assumption), and `schema().fields.type.listSize` (not `fixedSize`). Both fixed atomically in this plan.
