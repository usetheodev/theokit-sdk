# Changelog — @theokit/sdk-memory

## 0.2.0

### Minor Changes

- 809418a: M4-3 — typed categorized memory store (plan `m4-categorized-memory`).

  - `createCategorizedMemory({ root, categories })` — a typed, category-partitioned markdown memory store. `add(category, text)` validates `category` against the closed `categories` taxonomy (fail-loud `ConfigurationError(code: "unknown_category")` before any I/O), redacts secrets, and appends a bullet to `<root>/<category>.md` (frontmatter header + `## Facts`) atomically and serialized per category file (`withCwdMutex` — no lost update under concurrent adds). `list(category?)` returns `CategorizedFact[]` for one category or all; never throws (a missing file → no facts). Construction validates the taxonomy is non-empty, unique, sanitizable, and sanitized-unique.
  - `MemoryFact` gains an optional `category?: string` (backward-compatible — flat-store facts omit it).

  Composes the shipped `safePathJoin`/`sanitizeIdentifier` (`@theokit/sdk/path-safety`), `redactSecrets`, and `replaceFileAtomic`/`withCwdMutex` (`@theokit/sdk/internal/persistence`). Zero new dependencies — explicitly NOT adding `zod` (the closed `categories` set is the runtime-checked schema).

## [Unreleased]

### Changed

- Reorganized the flat 43-file `src/internal/` god folder into 5 sub-concern folders (arch-review M5): `embedding/` (10), `index/` (12), `active-memory/` (5), `dreaming/` (3), `store/` (7); 6 cross-cutting files (`adapter-catalog`, `adapter-http-error`, `circuit-breaker`, `memory-scope`, `memory-types`, `tools`) remain at the `internal/` root. Pure file moves + import-path updates — no behavior/API change (the package barrel `index.ts` re-exports identically); all 324 tests GREEN, `madge --circular` clean.

### Security (drift sync — iter 112/114/115, 2026-06-09)

Three security/perf hardenings shipped in `@theokit/sdk`'s
`internal/memory/` copies AFTER Stage 3 source-move completed
(iter 44-75) were silently absent from `@theokit/sdk-memory`'s
hybrid copies. Per ADR 0002 Stage 4 byte-equivalence invariant,
they have now been synced. Consumers routing through
`@theokit/sdk-memory` get the hardened behavior. The drift detector
(iter 93) caught each gap and flipped to PASS after the sync.

- **T4.9 — cross-tenant cache-key collision (iter 112)** —
  `active-memory-cache.ts`'s `cacheKey` now accepts an optional
  `TenantContext` (`namespace`/`userId`/`scope`) and NUL-separates
  every key part. Pre-sync, two users sharing a process with the
  same query could receive each other's cached result (DR4 finding
  #9 — CRITICAL cross-tenant data leak).

- **T4.6 — dreaming O(N²) sweep cap (iter 114)** —
  `dreaming-phases.ts`'s `remPhase` accepts an optional
  `maxFactsPerSweep` (default 500) and deterministically
  subsamples when input exceeds the cap. Pre-sync, a 5000-fact
  sweep ran 12.5M cosine-similarity comparisons (unacceptable).

- **T5.2 — Lance SQL escape hardening (iter 115)** —
  `lance-index.ts`'s `escapeSqlValue` now rejects NUL bytes,
  C0 control chars, and DEL via `ConfigurationError({code:
'sql_injection_blocked'})`, and escapes backslashes (`\` →
  `\\`) in addition to single quotes. Pre-sync, only `'` → `''`
  was applied — `\'` could escape the closing quote on engines
  that interpret backslash-escapes.

### Added (Stage 3 source-move COMPLETE — iter 44-75, 2026-06-08 → 2026-06-09)

38/38 source files from sdk-core's `internal/memory/*` now have
canonical hybrid copies in this package. sdk-core retains its copies
for v1.x back-compat; consumers installing this package get the
canonical surface that sdk-core's Stage 4 routing delegates to.

**Closed clusters:**

- Dreaming (iter 54+59+60): `dreaming-phases.ts`, `dreaming-diary.ts`,
  `dreaming-run.ts` + `active-memory-types.ts` (iter 48)
- Sessions (iter 61+62): `session-summary-writer.ts`, `session-loader.ts`
- Storage (iter 53+55-58+62): `markdown-store.ts`, `chunk-markdown.ts`,
  `reader.ts`, `transcript-store.ts`, `wiki-loader.ts`
- Index (iter 47+49-50+65-72): `index-manager-contract.ts`,
  `index-schema.ts`, `memory-index.ts`, `index-db.ts`,
  `sqlite-vec-loader.ts`, `vec-index.ts`, `lance-index.ts`,
  `lance-memory-adapter.ts`, `index-manager-dispatch.ts`,
  `index-manager.ts`
- Migration (iter 63+71): `migration.ts`, `migrate-sqlite-to-lance.ts`
- Adapters (iter 45+46+73+74): `embedding-adapter.ts`,
  `embedding-cache.ts`, `openai-compatible.ts` + inlined
  `adapter-http-error.ts` + 6 provider adapters
  (openai/mistral/openrouter/voyage/deepinfra/ollama) +
  `adapter-catalog.ts`
- Core (iter 44+51+52+64+75): `circuit-breaker.ts`,
  `active-memory-cache.ts`, `memory-types.ts`, `tools.ts`,
  `active-memory.ts`

**Optional peers** (sdk-memory dynamically loads when present):

- `better-sqlite3` (iter 65)
- `sqlite-vec` (iter 66)
- `@lancedb/lancedb` (iter 68)

**287 GREEN tests** across 38 files document every move's behavior;
**zero unexpected drift** between sdk-core and sdk-memory copies
(verified by the Stage 3 drift detector, iter 93).

### Added (Phase 1 Stage 3 prep — iter 33-35, 2026-06-08)

- `createInMemoryMarkdownProvider.recordSessionSummary` ships REAL
  filesystem-backed impl (was no-op). Writes
  `${cwd}/.theokit/memory/sessions/${sanitizeRunId(runId)}.md` via
  `replaceFileAtomic` imported from `@theokit/sdk/internal/persistence`
  (ADR-008 sub-path resolution). Mirrors sdk-core's legacy
  `writeSessionSummary` semantics — YAML frontmatter + User/Assistant
  sections, 2000-char truncation, runId sanitization.
- `runActivePass()` now reads previously-written session summaries
  from disk + substring-matches against the user message — closes
  the "write but never read" gap. In-process Map facts AND disk-recall
  hits both contribute to `systemPromptAdditions`. Capped at 5 hits
  per pass.
- NEW LLM-facing tool: `memory_search(query)` — surfaced in
  `buildTools` alongside `memory_remember`. The LLM can explicitly
  query the disk sessions corpus when the user references past
  conversations. Returns JSON `{ok, count, results: [{id, snippet}]}`.

### Changed (Phase 1 physical Stage 1 — iter 19, 2026-06-08)

- `createInMemoryMarkdownProvider` now implements the new optional
  `sync(handle)` port method (no-op for the in-process impl — facts
  are written synchronously to the Map at handler-call time; nothing
  to re-index post-run). Future LanceDB-backed impl will fire
  `IndexManager.sync()` here. Back-compat preserved: existing impls
  that omit `sync` are still valid per the optional-method spec.

## [0.1.0] — 2026-06-08

### Added

- Initial release. Consumes the `MemoryProvider` port from `@theokit/sdk@>=1.7.0`
  (SDK 2.0 Phase 1 / T1.6).
- `createInMemoryMarkdownProvider()` — first concrete impl. In-process
  fact store; LLM-facing `memory_remember` tool; `runActivePass()` emits
  `systemPromptAdditions` for recalled facts; full lifecycle compliance.

### Notes

- LanceDB / embeddings / circuit-breaker / dreaming-sweep deferred to future
  versions. This release ships the package foundation + a working impl so
  the SDK 2.0 cohort can publish (Phase 7).
- `peerDependency`: `@theokit/sdk >= 1.7.0` (where the port was shipped).
