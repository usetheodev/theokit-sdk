// Public API surface for @theokit/sdk-memory (SDK 2.0 Phase 1 / T1.6).
//
// Concrete `MemoryProvider` impls consuming the kernel-facing port from
// `@theokit/sdk`. Today: an in-process markdown-backed impl. Next iters
// ship LanceDB + embeddings + active-memory cache.

export { createInMemoryMarkdownProvider } from "./in-memory-provider.js";

// Iter 44: first Stage 3 file move — CircuitBreaker copied from sdk-core's
// internal/memory/circuit-breaker.ts. sdk-core retains its copy for v1.x
// active-memory back-compat; sdk-memory's canonical copy is what future
// rich providers (LanceDB-backed) will consume. Hybrid dual-copy mirrors
// Phase 2 physical Stage 1 (sdk-budget) pattern.
export * from "./internal/circuit-breaker.js";

// Iter 45: second Stage 3 file move — embedding-adapter types (61 LOC,
// pure type-only file). Defines the contract that provider adapters
// (openai-embedding, ollama-embedding, etc.) implement.
// `MemoryEmbeddingProviderAdapter` + `CreateAdapterOptions` +
// `EmbeddingRuntime` + `EmbeddingRuntimeStats` + `EmbeddingCache`.
export * from "./internal/embedding-adapter.js";

// Iter 46: third Stage 3 file move — LruEmbeddingCache (36 LOC).
// Concrete bounded-LRU impl of `EmbeddingCache` from iter 45's
// embedding-adapter types. KEPT INTERNAL — not re-exported from the
// public barrel because no Stage 1 surface consumes it yet. Lives in
// sdk-memory's internal/ so future rich providers (LanceDB-backed)
// can import it as a sibling. Rollup-plugin-dts treeshake limitation
// + lack of public consumer = internal-only. Will be promoted to
// public if/when a consumer surface needs it.

// Iter 47: fourth Stage 3 file move — index-manager-contract types
// (75 LOC, pure type-only). Defines `MemorySearchHit`, `IndexStatus`,
// `SearchOptions`, `MemoryBackend`, `OpenIndexOptions` — the contract
// every IndexManager impl (sqlite-vec, lance, future ANN backends)
// satisfies. Imports only `EmbeddingRuntime` from iter 45's
// embedding-adapter.
export * from "./internal/index-manager-contract.js";

// Iter 48: fifth Stage 3 file move — active-memory-types (24 LOC,
// pure type-only). Defines `ActiveMemoryQueryMode`, `ActiveMemoryStatus`,
// `ActiveMemoryResult`. Imports only `MemorySearchHit` from iter 47's
// index-manager-contract (sibling). Unblocks the upcoming
// `active-memory.ts` + `active-memory-cache.ts` moves.
export * from "./internal/active-memory-types.js";

// Iter 49: sixth Stage 3 file move — index-schema (61 LOC, zero
// imports). Defines `SCHEMA_STATEMENTS` + `PRAGMA_STATEMENTS` SQL
// constants for the SQLite memory index. Unblocks future `index-db`
// + `index-manager` + `vec-index` moves which depend on schema DDL.
export * from "./internal/index-schema.js";

// Iter 55: twelfth Stage 3 file move — reader (57 LOC).
// `readMemoryFileBounded(opts): Promise<MemoryReadResult>` — the
// bounded read with truncation info that powers ADR D5's
// `memory_get` tool. Mirrors OpenClaw's `buildMemoryReadResult`
// semantics (1-indexed `from`, default 200 lines, truncated=true
// when content remains past the slice). Default lines constant
// `DEFAULT_MEMORY_READ_LINES` also exported. Depends only on
// `node:fs/promises` + `node:path` + iter 52's `MemoryReadResult`
// (sibling import via ./memory-types.js).
export * from "./internal/reader.js";

// Iter 54: eleventh Stage 3 file move — dreaming-phases (149 LOC).
// Three-phase memory consolidation: `lightPhase` (cosine ≥ 0.95
// dedup) + `remPhase` (single-link agglomerative clustering at
// cosine ≥ 0.75) + `deepPhase` (consolidated-markdown renderer).
// Dependencies (both sibling): `EmbeddingRuntime` (iter 45) +
// `MemoryFact` (iter 52). Future `dreaming-run.ts` move composes
// with these three as sibling imports.
export * from "./internal/dreaming-phases.js";

// Iter 53: tenth Stage 3 file move — chunk-markdown (141 LOC).
// `chunkMarkdown(text, options?): MemoryChunk[]` algorithm mirrors
// OpenClaw's memory-host-sdk implementation per ADR D1 of the
// memory-system-openclaw-parity plan. Heading + blank-line aware,
// word-boundary aligned for oversized paragraphs (EC-6 enforced).
// Depends only on `node:crypto` + iter 52's MemoryChunk type
// (sibling import via ./memory-types.js).
export * from "./internal/chunk-markdown.js";

// Iter 52: ninth Stage 3 file move — memory-types (113 LOC).
// Public memory shape types: `MemoryConfig`, `MemoryFact`,
// `MemoryChunk`, `MemoryReadResult`, `MemoryFileEntry`, +
// `legacyMemoryJsonPath` helper for pre-ADR-D8 JSON path resolution,
// + canonical `redactSecrets` re-export from `@theokit/sdk` (ADR D68).
// Cross-package imports go through public sub-paths only —
// `@theokit/sdk/path-safety` (`safePathJoin` + iter 52-promoted
// `sanitizeIdentifier`) + `@theokit/sdk` (`redactSecrets`). Future
// `storage/*`, `migration`, `chunk-markdown` moves target this as
// sibling without re-importing from sdk-core.
export * from "./internal/memory-types.js";

// Iter 51: eighth Stage 3 file move — active-memory-cache (74 LOC).
// TTL-bounded + capacity-bounded LRU cache for `runActiveMemory`
// results. Depends only on `node:crypto` + iter 48's
// active-memory-types. `ActiveMemoryCache` class + `ActiveMemoryCacheOptions`
// interface exposed publicly — future `active-memory.ts` move targets
// this as a sibling. (No rollup-dts treeshake issue because
// `ActiveMemoryResult` is already publicly reachable via the barrel.)
export * from "./internal/active-memory-cache.js";

// Iter 50: seventh Stage 3 file move — memory-index (67 LOC).
// Defines `MemoryIndex` interface (the OCP-preserving 4-method
// contract — `sync`/`search`/`status`/`close` — both sqlite-vec and
// lance backends satisfy) + `SyncResult` + `parseSearchOptions`
// helper. Re-exports `IndexStatus`, `MemorySearchHit`, `SearchOptions`
// from iter 47's index-manager-contract for stable internal import
// paths. **Side-effect:** the public re-export of `MemorySearchHit`
// here unblocks the rollup-plugin-dts treeshake limitation that
// forced the iter 48 inline-duplicate workaround — that mirror is
// dropped in this same iter (see internal/active-memory-types.ts).
export * from "./internal/memory-index.js";
