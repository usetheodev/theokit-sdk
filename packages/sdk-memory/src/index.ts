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

// Iter 62: nineteenth Stage 3 file move — session-loader (45 LOC).
// Session summary discovery per ADR D20. Mirrors iter 57's
// `wiki-loader` shape: scans `.theokit/memory/sessions/*.md` and
// emits `{absolutePath, relPath}` records that future indexer moves
// tag with `source="sessions"` for `memory_search { corpus: "sessions" }`
// filter. `discoverSessionFiles` + `SessionFile`. CLOSES the
// sessions/ cluster in sdk-memory (writer iter 61 + loader this iter).
// Dependencies all sibling: `memoryDir` from markdown-store (iter 56)
// + `sessionsDir` from session-summary-writer (iter 61).
export * from "./internal/session-loader.js";

// Iter 61: eighteenth Stage 3 file move — session-summary-writer (88 LOC).
// Per-run session summary writer per ADR D20. After every finished
// run, writes a markdown summary to
// `.theokit/memory/sessions/<runId>.md`. EC-9: only `status === "finished"`
// runs trigger a write — cancelled/errored runs would otherwise pollute
// the recall corpus with partial transcripts. Both user and assistant
// text run through redactSecrets (ADR D68) + char-truncate at 2000
// before persist. runId sanitized to `[a-zA-Z0-9_-]` so a malicious
// id cannot escape the sessions directory. Future indexer moves tag
// these with `source="sessions"` for memory_search corpus filter.
// `writeSessionSummary` + `sessionsDir` + `sessionSummaryPath` +
// `SessionSummaryInput`.
export * from "./internal/session-summary-writer.js";

// Iter 60: seventeenth Stage 3 file move — dreaming-run (110 LOC).
// Dreaming sweep orchestrator per ADR D7. Composes:
//   - readFactsFromMarkdown (iter 56) — input
//   - lightPhase (iter 54)            — dedup
//   - remPhase   (iter 54)            — cluster
//   - deepPhase  (iter 54)            — consolidated-notes render
//   - appendDiaryEntry (iter 59)      — diary append
// All file writes go through `replaceFileAtomic` (EC-3); the whole
// sweep holds `withCwdMutex` so a concurrent `Remember:` append
// can't race it. `runDreamingSweep(options): Promise<DreamingResult>`
// is the public entrypoint, with DreamingOptions + DreamingResult
// shapes. Failures are swallowed with stderr warn (status: "error")
// so a single sweep crash never bubbles into the agent loop.
// CLOSES the dreaming/ cluster — 4 files (phases/diary/run + types)
// fully in sdk-memory.
export * from "./internal/dreaming-run.js";

// Iter 59: sixteenth Stage 3 file move — dreaming-diary (74 LOC).
// Dream-diary append per ADR D7. Diary lives at
// `.theokit/memory/dream-diary.md` and grows with one entry per
// sweep. Content-hashed entry for idempotency; atomic writes via
// replaceFileAtomic (EC-3) so a crash mid-write can't leave a
// half-written diary. `appendDiaryEntry(cwd, entry)` + `diaryPath`
// + `renderDiaryEntry` + `entryHash` + `DiaryEntry` interface.
// Future `dreaming-run.ts` move (post-sweep summary writer) composes
// with this as sibling. Dependencies all resolved: persistence
// sub-path + markdown-store (iter 56).
export * from "./internal/dreaming-diary.js";

// Iter 58: fifteenth Stage 3 file move — transcript-store (48 LOC).
// Optional on-disk persistence for Active Memory recall transcripts
// per ADR D6. `persistActiveMemoryTranscript(cwd, transcript)` writes
// one JSON file per run under
// `.theokit/memory/transcripts/active-memory/<runId>.json` via
// atomicWriteJson (no torn writes during crash). Failures are
// swallowed with a stderr warning so transcript IO never crashes the
// agent run. ActiveMemoryTranscript shape exported for consumer
// typing. Future `active-memory.ts` move composes with this as
// sibling. Dependency chain (both resolved): persistence sub-path +
// `./markdown-store.js` (iter 56).
export * from "./internal/transcript-store.js";

// Iter 57: fourteenth Stage 3 file move — wiki-loader (50 LOC).
// Read-only wiki supplement discovery (ADR Phase 10 of
// memory-system-openclaw-parity). Lists `.theokit/memory/wiki/*.md`
// and emits `{absolutePath, relPath}` records that future indexer
// moves (`index-db`/`index-manager`) consume with `source="wiki"`
// chunk tagging so `memory_search { corpus: "wiki" }` filter scopes
// hits. Depends on sibling `./markdown-store.js` for `memoryDir`
// (moved iter 56).
export * from "./internal/wiki-loader.js";

// Iter 56: thirteenth Stage 3 file move — markdown-store (134 LOC).
// Markdown-first memory storage primitives per ADR D1 of the
// memory-system-openclaw-parity plan. Public path helpers
// (`memoryDir`, `memoryMdPath`, `notesDir`), fact reader+writer
// (`readFacts`, `appendFact`, `readFactsFromMarkdown`,
// `appendFactToMarkdown`), and notes lister (`listNotes`). All writes
// go through `replaceFileAtomic` + per-cwd mutex (EC-4) via the
// public `@theokit/sdk/internal/persistence` sub-path.
// Configuration-aware accessors honor MemoryConfig.enabled gate.
// Future `tools.ts`, `dreaming-diary`, `dreaming-run`,
// `session-loader`, `session-summary-writer`, `transcript-store`,
// `wiki-loader`, `migration` moves all compose with this as sibling.
export * from "./internal/markdown-store.js";

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
