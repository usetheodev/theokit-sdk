# Changelog — @theokit/sdk-memory

## [Unreleased]

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
