# Plan: Memory System — OpenClaw Parity

> **Version 1.0** — Replicate the OpenClaw memory architecture inside `@usetheo/sdk`. This is a **multi-month effort, ~10 sequential phases, ~80-120 new files, ~15k LoC**. The OpenClaw reference is ~304 files spread across 5 plugin packages (`memory-core` 120, `memory-host-sdk` 97, `active-memory` 4, `memory-lancedb` 12, `memory-wiki` 64, plus 7 provider embedding adapters). The plan ships a **functionally equivalent** stack adapted to our internal-module shape (we have no plugin host, so what OpenClaw calls "extensions" become `packages/sdk/src/internal/memory/<sub>/`). Every public surface and every behavior described in OpenClaw's memory docs lands.

> **Realistic timeline:** 5-10 weeks of focused engineering depending on how aggressively edge cases get covered. Each phase ships independently — pause at any green phase boundary.

## Context

### What exists today
Our memory subsystem is a 64-LoC JSON-array file (`packages/sdk/src/internal/runtime/memory-store.ts`) backed by `.theokit/memory/<namespace>/<scope>-<userId>.json`. Auto-write detects `Remember: <fact>` regex on the user message and appends. Auto-recall reads the entire array and dumps it into a `<memory>` system-prompt block. No index, no search, no chunking, no embeddings, no consolidation, no relevance ranking. Token budget for recall is unbounded (EC-7 documented in `runtime-gaps-fix-edge-cases.md`).

### What OpenClaw has
A complete RAG-grade memory engine. Verified by inspection of `referencia/openclaw/`:
- **Markdown-first corpus:** `MEMORY.md` plus `memory/*.md` files, human-editable, git-friendly, chunked by heading/paragraph.
- **Hybrid index:** SQLite with FTS5 (lexical) + sqlite-vec (vector) hybrid scoring per `manager-search.ts`.
- **Embedding pipeline:** 7 provider adapters (OpenAI, Mistral, Voyage, DeepInfra, LMStudio, Google, Amazon Bedrock) behind a single `MemoryEmbeddingProviderAdapter` interface, with batch upload/status APIs.
- **Two tools:** `memory_search` (semantic+lexical hybrid) and `memory_get` (exact excerpt by path+lines).
- **Active Memory** (`extensions/active-memory/`): blocking sub-agent that runs before each reply, calls the memory tools, injects results into the prompt context. Has circuit breaker (3 consecutive timeouts → cooldown 60s), persistable transcripts, query modes (`message`/`recent`/`full`), prompt styles, per-chat allow/deny lists.
- **Dreaming/REM:** cron-triggered deep consolidation pipeline (`dreaming-phases.ts`, `dreaming-narrative.ts`, `rem-evidence.ts`, `rem-harness.ts`) producing a Dream Diary that compacts and reorganizes memory.
- **Alternate backend:** `memory-lancedb` swaps the SQLite-vec for LanceDB without changing the public tool surface.
- **Wiki supplements:** `memory-wiki` extension exposes additional read-only corpora (`corpus=wiki`).
- **Citations + visibility:** result snippets carry source paths + line ranges; session-visibility rules limit which sessions can see which hits.
- **Doctor + setup contracts:** programmatic health checks (`doctor-contract-api.ts`, `setup-api.ts`).

The full surface is described by `referencia/openclaw/extensions/memory-core/src/memory/index.ts`, the SDK seam at `referencia/openclaw/src/plugin-sdk/memory-core-host-engine-storage.ts`, and the engine helpers at `referencia/openclaw/packages/memory-host-sdk/src/host/`.

### Why now
The current memory implementation works for ≤50 facts and breaks down beyond that. Real workloads (developer assistants, long-running cron agents, multi-session research) routinely accumulate hundreds to thousands of memory items. Without indexed search, every recall blows the context window. The user explicitly asked for "exatamente igual o OpenClaw" — that target is what we plan against.

## Objective

`@usetheo/sdk` exposes a memory subsystem behaviorally equivalent to OpenClaw's `memory-core` + `active-memory` + `memory-wiki` + dreaming + at minimum 2 embedding adapters (OpenAI + a fallback) + one vector backend (SQLite-vec) with an interface stable enough to add LanceDB later.

**Measurable goals:**
1. Memory persists to `.theokit/memory/MEMORY.md` (root) and `.theokit/memory/notes/*.md` (per-topic), readable and editable by humans.
2. `memory.search(query)` returns ranked `MemorySearchResult[]` with `path`, `startLine`, `endLine`, `score`, `vectorScore`, `textScore`, `snippet`, `source`, `citation`.
3. `memory.read(path, from?, lines?)` returns bounded excerpts with truncation info.
4. Public agent tools `memory_search` + `memory_get` available to the LLM (MCP-compatible shape).
5. **Active Memory mode** (opt-in via `AgentOptions.memory.activeRecall: true`): a blocking sub-agent runs before each `send()`, invokes `memory_search/get`, and prepends results to the assembled system prompt with a token budget. Honors circuit breaker (3 timeouts → 60s cooldown), per-chat allow/deny lists, timeout (default 15s), query modes.
6. Dreaming sweep runs on a cron schedule (`memory.dreaming.frequency`), consolidates short-term entries into permanent notes, produces a dream-diary markdown file.
7. Embedding adapters: OpenAI implemented, contract for 6 others stubbed and documented; switching providers is one config field.
8. All 188 pre-existing tests stay green. New tests fully cover the public memory surface and core invariants.
9. Quality gates G1-G10 remain green.
10. The legacy JSON-array storage migrates seamlessly on first read (one-time conversion to markdown).

## ADRs

### D1 — Markdown-first corpus as canonical storage
**Decision:** Memory facts live as markdown text inside `.theokit/memory/MEMORY.md` (root) and `.theokit/memory/notes/<slug>.md` (per-topic notes). The JSON-array store is migrated on first read and deleted after a successful migration write.

**Rationale:** OpenClaw uses markdown end-to-end because (a) humans can edit, audit, and version-control memory directly; (b) markdown structure (headings, paragraphs) is a natural chunking unit; (c) downstream RAG benefits from heading metadata in citations. Alternative: keep JSON but add a parallel markdown export — rejected because two stores drift. Single source of truth is the markdown corpus.

**Consequences:** All read/write paths route through a markdown manager. Migration code reads legacy JSON, writes equivalent markdown bullets under MEMORY.md `## Facts`, deletes JSON. Backward read compat for one minor cycle (warn-and-migrate).

### D2 — SQLite + FTS5 + sqlite-vec as the primary index
**Decision:** Index lives in `.theokit/memory/.index/memory.sqlite` with three tables: `files` (path, mtime, hash), `chunks` (id, file_id, start_line, end_line, text, hash), and `embeddings` (chunk_id, vector — using `sqlite-vec` extension). FTS5 virtual table `chunks_fts` mirrors `chunks.text` for lexical search.

**Rationale:** Matches OpenClaw's `memory-host-sdk/src/host/memory-schema.ts` exactly. SQLite is zero-dependency for end-users (Node's built-in `node:sqlite` is sufficient when available; `better-sqlite3` is the fallback). `sqlite-vec` is the same extension OpenClaw uses. Alternative: pure in-memory cosine-only — rejected because cold-start re-indexing on every process boot is O(n²) and embeddings are expensive. Alternative: LanceDB — defer to Phase 12 as an alternate backend.

**Consequences:** Adds optional native dep `sqlite-vec` (peer dep so users opting out of vector search don't pay for it). FTS-only mode supported via a `backend: "fts-only"` config when no embedding provider is available. Read-only recovery mode supported when DB is corrupt.

### D3 — Embedding provider adapter interface
**Decision:** A single `MemoryEmbeddingProviderAdapter` interface (mirrors OpenClaw's `memory-core-host-engine-embeddings`) with fields `id`, `defaultModel`, `transport: "local" | "remote"`, `authProviderId`, `autoSelectPriority`, `create(options) → { provider, runtime }`, plus runtime methods `embed(texts) → number[][]` and `embedBatch(texts) → batch handle`. The runtime supports both sync embed calls and batch APIs (for cost optimization).

**Rationale:** Aligns 1:1 with `referencia/openclaw/extensions/openai/memory-embedding-adapter.ts`. Adding providers becomes one new file per provider. Alternative: bake OpenAI in — rejected because the request was OpenClaw parity and OpenClaw is provider-pluggable.

**Consequences:** OpenAI adapter ships in Phase 4. Other 6 (Mistral, Voyage, DeepInfra, LMStudio, Google, Bedrock) stub with `not-implemented` errors until Phase 11. Auth integration reuses existing `THEOKIT_API_KEY` patterns + provider-specific env vars.

### D4 — Hybrid search scoring
**Decision:** Default search runs FTS + vector queries in parallel, combines scores via `combinedScore = vectorWeight * vectorScore + textWeight * textScore` (defaults `0.6` / `0.4`), and returns top-K. Configurable per-call via `search(query, { vectorWeight, textWeight })`.

**Rationale:** OpenClaw's `manager-search.ts hybrid.ts` does exactly this. Vector recall has high precision on semantically related content; FTS handles exact-match tokens (names, codes). Pure-vector underperforms on rare terms; pure-FTS misses paraphrasing. Hybrid is the documented best practice.

**Consequences:** Both indexes must be kept in sync. Atomic reindex helper (`manager-atomic-reindex.ts`) ensures partial failures don't leave inconsistent state.

### D5 — Tool surface follows OpenClaw exactly
**Decision:** Two public tools exposed to the LLM: `memory_search(query, { maxResults?, minScore?, corpus? })` and `memory_get(path, { from?, lines? })`. Same JSON schemas as OpenClaw's `extensions/memory-core/src/tools.ts` lines 228-475. `corpus` accepts `"memory"` / `"sessions"` / `"wiki"` / `"all"`.

**Rationale:** Verbatim parity is the stated objective. Tool schemas drive the LLM's understanding; matching OpenClaw means agents trained against OpenClaw's tool descriptions migrate trivially.

**Consequences:** Tools register via the existing `ResolvedTool` interface in `tool-dispatch.ts`. They become visible in `agent.send()` only when `memory.enabled === true` AND `memory.tools !== false` (config default: enabled).

### D6 — Active Memory as blocking sub-agent
**Decision:** When `memory.activeRecall: true`, every `agent.send()` runs a blocking sub-agent BEFORE assembling the system prompt. The sub-agent receives the user message + recent turns (per `queryMode`), has access only to `memory_search`/`memory_get` (per `toolsAllow`), and produces a memory summary that prepends to the `<memory>` block. Default timeout 15s; circuit breaker 3 consecutive timeouts → 60s cooldown.

**Rationale:** OpenClaw's blocking recall pattern is what makes memory work at scale: a tiny dedicated model curates what to surface. Without it, the main agent either ignores memory or blows the context window. Alternative: rely on the main agent calling tools itself — rejected because main agents under-call tools and over-include irrelevant facts.

**Consequences:** New internal sub-agent runner. Reuses `LocalAgent` but with a minimal toolset and a system prompt template tuned for recall extraction. Cache TTL 15s avoids duplicate calls on quick consecutive sends.

### D7 — Dreaming as cron-driven consolidation
**Decision:** A `dreaming` cron job (configurable frequency, default `"0 3 * * *"`) sweeps short-term memory entries, deduplicates them via semantic similarity, summarizes thematic clusters, and rewrites them into permanent `memory/*.md` notes. Produces a `dream-diary.md` audit log of every consolidation.

**Rationale:** OpenClaw's `dreaming-phases.ts` defines REM (light → dream → deep) phases. Without consolidation, memory grows unbounded and recall accuracy decays. Cron-driven matches user mental model (overnight maintenance).

**Consequences:** New `dreaming/` module. Reuses existing `Cron` primitives. Dreaming output is itself markdown indexed by the same engine. Idempotent (re-running produces identical diary entry hashes).

### D8 — Backward compatibility via one-shot migration
**Decision:** On first instantiation of the new memory manager, if `.theokit/memory/<namespace>/<scope>-<userId>.json` exists AND `.theokit/memory/MEMORY.md` does not, read the JSON facts, write equivalent markdown bullets under `MEMORY.md ## Facts`, then delete the JSON. Emit a one-line stderr migration message.

**Rationale:** Users with existing memory files must not lose data. One-shot migration is the cheapest path; no permanent dual-store complexity.

**Consequences:** Migration is silent and safe (read-only fallback if the markdown directory is read-only — leave both files intact and warn). Documented in CHANGELOG.

### D9 — Session-visibility rules carry over
**Decision:** Memory search results are filtered by `sessionKey` visibility — chunks tagged with a `sessionKey` are only surfaced to that session, except via the `sessions` corpus which has its own visibility model.

**Rationale:** OpenClaw's `session-search-visibility.ts` prevents cross-tenant leakage in multi-user deployments. Our SDK is single-process but the same rule generalizes to multi-agent setups (one workspace, several agents).

**Consequences:** Chunks carry an optional `sessionKey` column. Filter applied in `manager.search` before scoring.

### D10 — Auto-write keeps the `Remember:` trigger but writes markdown
**Decision:** The existing v1-completeness auto-write (regex `^\s*Remember:\s*(.+)$`) keeps firing, but writes one bullet to `MEMORY.md ## Facts`, NOT a JSON entry. Empty facts still skip. The shared helper `extractMemoryFact` keeps its signature; only the backing storage changes.

**Rationale:** Don't regress an already-shipped public behavior. The trigger is opt-in (`memory.enabled === true`) and orthogonal to the new index/tools.

**Consequences:** `appendMemoryFact` becomes a thin wrapper around the markdown writer. Backwards-compatible.

## Dependency Graph

```
Phase 1 (markdown corpus) ──▶ Phase 2 (chunking + read) ──▶ Phase 3 (FTS index)
                                                                  │
                                                                  ▼
                                                          Phase 4 (embedding adapter interface)
                                                                  │
                                                                  ▼
                                                          Phase 5 (vector index + hybrid search)
                                                                  │
                                                                  ▼
                                                          Phase 6 (memory_search/get tools)
                                                                  │
                                                                  ▼
                                                          Phase 7 (Active Memory sub-agent)
                                                                  │
                                                                  ▼
                                                          Phase 8 (circuit breaker + transcripts + cache)
                                                                  │
                                                                  ▼
                                                          Phase 9 (dreaming/REM consolidation)
                                                                  │
                                                                  ▼
                                                          Phase 10 (memory-wiki supplements)
                                                                  │
                            Phase 11 (extra embedding adapters) ──┤
                            Phase 12 (LanceDB alt backend) ───────┤
                                                                  ▼
                                                          Phase 13 (cross-validation)
                                                                  │
                                                                  ▼
                                                          Final Phase: Dogfood QA
```

**Parallelization:** Phase 11 (multi-provider adapters) and Phase 12 (LanceDB backend) can run in parallel with each other once Phase 5/6 land. Phases 1-10 are strictly sequential.

---

## Phase 1: Markdown corpus + migration

**Objective:** Replace the JSON-array store with markdown files; migrate existing data losslessly.

### T1.1 — Implement `MarkdownMemoryStore`

#### Objective
Read/write/append memory facts as markdown files under `.theokit/memory/`. Migrate legacy JSON on first read.

#### Evidence
Current `memory-store.ts` is 64 LoC of JSON IO. OpenClaw's equivalent (`packages/memory-host-sdk/src/host/read-file.ts`, `engine-storage.ts`) reads markdown with bounded line ranges and tracks file mtime+hash. The shape we need at this phase: `MEMORY.md` for primary facts + `notes/*.md` for per-topic memory. Migration is mandatory for D8.

#### Files to edit
```
packages/sdk/src/internal/memory/markdown-store.ts — (NEW) read/write markdown files; migrate JSON on first read
packages/sdk/src/internal/memory/migration.ts — (NEW) one-shot JSON-to-markdown migration
packages/sdk/src/internal/runtime/memory-store.ts — (MODIFY) delegate read/append to MarkdownMemoryStore; keep public function signatures stable
packages/sdk/src/internal/runtime/local-agent.ts — (MODIFY) update maybePersistMemoryFactFromUserMessage to call the new writer
```

#### Deep file dependency analysis
- `markdown-store.ts` (new): `readFacts(cwd, config) → MemoryFact[]`, `appendFact(cwd, config, fact)`, `listNotes(cwd) → NoteFile[]`. Pure file IO.
- `migration.ts` (new): `migrateLegacyJson(cwd, config) → { migrated: boolean; factCount: number }`. Runs once per config, idempotent.
- `memory-store.ts` (modified): keeps `readMemoryFacts` + `appendMemoryFact` exports (same signatures). Internally delegates.
- `local-agent.ts` is untouched in interface; only the underlying storage shape changes.

#### Deep Dives
- **File layout:**
  ```
  .theokit/memory/
  ├── MEMORY.md              # Root facts under "## Facts" heading
  └── notes/
      ├── <slug>.md          # Optional per-topic notes (manually authored or dreamed)
      └── ...
  ```
- **MEMORY.md template:**
  ```markdown
  # Memory

  > Auto-managed by @usetheo/sdk. Edit freely — the SDK reads from here.

  ## Facts

  - Magic-number for this workspace is 8675309.
  - User prefers Vitest as the test runner.
  ```
- **Append semantics:** new bullet appended to `## Facts` section. If section missing, create it.
- **Migration triggers:** detected when `MEMORY.md` is absent AND legacy JSON exists. Atomic via `replaceFileAtomic` (write to `.tmp`, then rename).
- **Edge cases:** read-only filesystem → migration aborts, warns stderr, keeps reading from JSON. Corrupt JSON → migration aborts (legacy `readMemoryFacts` already returns `[]` on parse error).

#### Tasks
1. Create `markdown-store.ts` with `readFacts`, `appendFact`, `listNotes`.
2. Create `migration.ts` with `migrateLegacyJson`.
3. In `memory-store.ts`, rewrite `readMemoryFacts` to call `migrateLegacyJson` first, then `readFacts`. Same for `appendMemoryFact`.
4. Add a `MEMORY.md` template constant.
5. **EC-4 (MUST FIX): Atomic write + in-process serialization for `appendFact`.** All writes go through a `replaceFileAtomic(<file>, <content>)` helper (write to `<file>.tmp`, fsync, rename). Wrap `appendFact` in a per-`cwd` `Map<cwd, Promise>` mutex so two concurrent calls execute sequentially. Multi-process concurrency stays out of scope for v1 (DOCUMENT in README).

#### TDD
```
RED:     markdownStore_writes_fact_to_memory_md() — appendFact + readFacts roundtrip.
RED:     markdownStore_appends_under_facts_heading() — multiple appends produce a clean bulleted list.
RED:     migration_converts_legacy_json_to_markdown() — pre-populated JSON file → after first readFacts, MEMORY.md exists with same facts and JSON is deleted.
RED:     migration_is_idempotent() — second read does nothing; migration flag respected.
RED:     migration_skips_when_markdown_already_exists() — JSON + MEMORY.md both present → don't touch either; warn.
RED:     migration_no_crash_on_readonly_fs() — mock read-only fs; readFacts still returns legacy facts; stderr warning emitted.
RED:     redactSecrets_still_applied() — secret-shaped tokens in appended fact get stripped before markdown write.
RED:     markdownStore_creates_facts_section_when_missing() — pre-populate `# Title\n\nrandom text` without `## Facts`; appendFact adds the section AND preserves prior content (EC-5).
RED:     markdownStore_serializes_concurrent_appends() — 5 parallel appendFact calls → all 5 bullets present after the last promise resolves (EC-4).
GREEN:   Implement steps 1-5.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/markdown-store.golden.test.ts
```

#### Acceptance Criteria
- [ ] 7 golden tests pass.
- [ ] All 188 pre-existing tests still pass.
- [ ] `examples/memory` runs against real OpenRouter using markdown storage (visible MEMORY.md after agent-1 says "Remember:").
- [ ] Legacy JSON files convert losslessly.
- [ ] Pass: G1-G10.

#### DoD
- [ ] `pnpm typecheck` exits 0.
- [ ] `MEMORY.md` shows up under the example's tmpdir.
- [ ] CHANGELOG entry.

---

## Phase 2: Chunking + bounded read API

**Objective:** Split markdown into semantic chunks; expose `read(path, from?, lines?)` with truncation info.

### T2.1 — Implement `chunkMarkdown` + `MemoryReader`

#### Objective
Produce stable, semantically-meaningful chunks from markdown files; expose a read API that mirrors OpenClaw's `buildMemoryReadResult`.

#### Evidence
OpenClaw's `packages/memory-host-sdk/src/host/chunk-markdown.ts` chunks by heading/paragraph with a token cap. `memory_get` tool uses bounded reads with `from`/`lines` defaulting to `DEFAULT_MEMORY_READ_LINES=200`. This is the data structure every later phase indexes.

#### Files to edit
```
packages/sdk/src/internal/memory/chunk-markdown.ts — (NEW) markdown → chunks
packages/sdk/src/internal/memory/reader.ts — (NEW) bounded read with truncation info
packages/sdk/src/internal/memory/types.ts — (NEW) MemoryChunk, MemoryReadResult, MemoryFileEntry
```

#### Deep file dependency analysis
- `types.ts`: pure type declarations mirroring `referencia/openclaw/packages/memory-host-sdk/src/host/engine-storage.ts:42-62`.
- `chunk-markdown.ts`: pure function. Splits by `^#+` headings and blank-line paragraph boundaries. Each chunk carries `startLine`, `endLine`, `text`, `hash`, optional `heading`.
- `reader.ts`: opens file, returns lines `[from, from+lines)`, attaches truncation flags + remaining-content info.

#### Deep Dives
- **Chunk size:** default max 800 chars; minimum 80. Tunable via config later.
- **Stable hashes:** `chunk.hash = sha256(text)`. Used downstream for embedding cache invalidation.
- **Read invariants:** `from` 1-indexed; `lines` defaults to 200; if `from + lines > file_lines`, returns up to EOF with `truncated: false`.

#### Tasks
1. Write `types.ts`.
2. Write `chunk-markdown.ts` with `chunkMarkdown(text, options?) → MemoryChunk[]`.
3. Write `reader.ts` with `readFile({ cwd, relPath, from?, lines? }) → MemoryReadResult`.

#### TDD
```
RED:     chunkMarkdown_splits_on_heading_boundaries() — `# A\nbody\n# B\nbody2` → 2 chunks.
RED:     chunkMarkdown_respects_max_chars() — long paragraph splits at 800 chars.
RED:     chunkMarkdown_assigns_stable_hashes() — same input → same hashes.
RED:     reader_returns_bounded_slice() — read 5 lines from line 10 → exactly those 5 lines + line numbers.
RED:     reader_flags_truncation() — reading past EOF → truncated=false, remainingLines=0.
RED:     reader_default_200_lines() — no lines arg → reads up to 200 lines.
RED:     chunkMarkdown_splits_on_word_boundary_not_mid_word() — paragraph of 1500 chars without whitespace at the 800th char → split point is the nearest whitespace ≤ maxChars, not exactly at 800 (EC-6).
GREEN:   Implement steps 1-3.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/chunk-and-read.golden.test.ts
```

#### Acceptance Criteria
- [ ] 6 golden tests pass.
- [ ] No regression.
- [ ] Pass: G1-G10.

#### DoD
- [ ] Types exported from `packages/sdk/src/internal/memory/types.ts`.
- [ ] Pure functions (no IO) for `chunkMarkdown`; isolated IO in `reader.ts`.

---

## Phase 3: SQLite + FTS5 index

**Objective:** Persistent index of all memory chunks with FTS5 lexical search. No vectors yet.

### T3.1 — Schema + index manager (FTS-only mode)

#### Objective
Open/create a SQLite DB at `.theokit/memory/.index/memory.sqlite` with tables `files`, `chunks`, `chunks_fts`. Provide `index.sync()`, `index.search(query, opts)`, `index.status()`.

#### Evidence
OpenClaw's `extensions/memory-core/src/memory/manager-db.ts`, `manager-fts-state.ts`, `manager-search.ts` define this exact contract. FTS5-only mode (when no embedding provider is configured) is a documented fallback there (`backend: "fts-only"`).

#### Files to edit
```
packages/sdk/src/internal/memory/index-schema.ts — (NEW) CREATE TABLE / virtual table statements
packages/sdk/src/internal/memory/index-db.ts — (NEW) DB connection mgmt + WAL config
packages/sdk/src/internal/memory/index-manager.ts — (NEW) sync(), search(), status()
packages/sdk/package.json — (MODIFY) add optional peer dep `better-sqlite3` (or rely on `node:sqlite` for Node 22+)
```

#### Deep file dependency analysis
- `index-schema.ts`: schema constants. No runtime behavior.
- `index-db.ts`: `openDb(path) → DB`. WAL mode on. Idle-checkpoint maintenance per OpenClaw `configureMemorySqliteWalMaintenance`.
- `index-manager.ts`: `IndexManager` class. Constructor takes `cwd` + `embeddingProvider?` (optional for FTS-only mode).

#### Deep Dives
- **Schema:**
  ```sql
  CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT UNIQUE, mtime INTEGER, hash TEXT);
  CREATE TABLE chunks (id INTEGER PRIMARY KEY, file_id INTEGER, start_line INTEGER, end_line INTEGER, text TEXT, hash TEXT, session_key TEXT);
  CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id');
  -- vector column added in Phase 5 via sqlite-vec
  ```
- **Sync algorithm:** walk markdown corpus → compute file hash → if changed, delete old chunks for file, insert new chunks, update FTS.
- **Status fields:** `{ backend: "fts-only", filesIndexed, chunksIndexed, lastSyncMs, provider: undefined }`.

#### Tasks
1. Write `index-schema.ts`.
2. Write `index-db.ts` with `openDb`, `closeDb`, WAL maintenance.
3. Write `index-manager.ts` with `sync`, `search` (FTS5 BM25 ranking), `status`, `close`.
4. Add `better-sqlite3` as optional peer dep with fallback to `node:sqlite`.

#### TDD
```
RED:     indexManager_creates_schema_on_first_open() — fresh dir → tables exist.
RED:     indexManager_indexes_markdown_chunks() — write MEMORY.md → sync → chunks table populated.
RED:     indexManager_fts_search_returns_ranked_hits() — query matches text → score > 0, top hit text contains query.
RED:     indexManager_reindexes_changed_file() — modify MEMORY.md → sync → old chunks gone, new chunks present.
RED:     indexManager_status_reports_counts() — after sync, status.filesIndexed > 0.
RED:     indexManager_handles_empty_corpus() — no markdown files → sync ok, search returns [].
RED:     indexManager_atomic_reindex_on_error() — sync interrupted mid-write → next sync recovers cleanly (no orphan chunks).
RED:     indexManager_recovers_from_corrupt_db() — write garbage bytes to `.index/memory.sqlite`; on open, either rename aside to `.corrupt-<ts>` + recreate the schema, OR throw `ConfigurationError(code: "index_corrupt")` (EC-7).
GREEN:   Implement steps 1-4.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/index-manager.golden.test.ts
```

#### Acceptance Criteria
- [ ] 7 golden tests pass.
- [ ] `pnpm validate` exit 0.
- [ ] Bundle size impact ≤ 50 KB before vec extension.

#### DoD
- [ ] DB initializes on first call; subsequent calls reuse open connection.
- [ ] FTS-only mode works without any embedding provider.

---

## Phase 4: Embedding provider adapter interface + OpenAI implementation

**Objective:** Pluggable embedding interface; one production-ready adapter (OpenAI).

### T4.1 — Define `MemoryEmbeddingProviderAdapter` interface

#### Objective
Type the contract every adapter implements. Mirror `referencia/openclaw/extensions/openai/memory-embedding-adapter.ts` shape exactly.

#### Files to edit
```
packages/sdk/src/internal/memory/embedding-adapter.ts — (NEW) interface + helper types
```

#### TDD
```
RED:     adapter_shape_matches_openclaw_contract() — type-level: id, defaultModel, transport, authProviderId, autoSelectPriority, create() return shape.
GREEN:   Implement type interface.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/embedding-adapter.golden.test.ts
```

#### Acceptance Criteria
- [ ] Type contract test passes.
- [ ] No runtime code yet.

#### DoD
- [ ] Interface published from `internal/memory/embedding-adapter.ts`.

### T4.2 — Implement OpenAI embedding adapter

#### Objective
Working adapter calling `/v1/embeddings` with batch + retry; default model `text-embedding-3-small`.

#### Files to edit
```
packages/sdk/src/internal/memory/adapters/openai-embedding.ts — (NEW) adapter implementation
packages/sdk/src/internal/memory/embedding-cache.ts — (NEW) LRU keyed by text hash
```

#### Tasks
1. Write `openai-embedding.ts` adapter: `embed(texts) → number[][]`; uses native fetch; honors `OPENAI_API_KEY` + `OPENAI_API_BASE_URL`; chunks requests at 100 texts per call.
2. Write `embedding-cache.ts`: in-memory LRU, max 5000 entries default, keyed by `sha256(text)`.

#### TDD
```
RED:     openaiAdapter_embeds_text() — stub /v1/embeddings → returns vector of correct dimension.
RED:     openaiAdapter_batches_requests() — 250 texts → 3 HTTP calls (100/100/50).
RED:     openaiAdapter_caches_repeated_texts() — same text twice → 1 HTTP call.
RED:     openaiAdapter_throws_typed_error_on_401() — stub 401 → throws AuthenticationError.
RED:     openaiAdapter_retries_on_429_with_backoff() — stub 429 then 200 → succeeds after one retry.
RED:     openaiAdapter_retries_on_5xx_with_backoff() — stub 503 then 200 → succeeds after one retry (5xx is the common transient failure mode, EC-9).
GREEN:   Implement steps 1-2.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/openai-embedding.golden.test.ts
```

#### Acceptance Criteria
- [ ] 5 golden tests pass.
- [ ] Adapter exposed via `AgentOptions.memory.embedding = { provider: "openai", model?: "text-embedding-3-small" }`.

#### DoD
- [ ] Native fetch only; no `openai` SDK dep.
- [ ] Cache hit rate observable via `adapter.runtime.stats()`.

---

## Phase 5: Vector index (sqlite-vec) + hybrid search

**Objective:** Store embeddings alongside chunks; combine vector + FTS scores in hybrid search per D4.

### T5.1 — Add vector column + sqlite-vec extension loading

#### Files to edit
```
packages/sdk/src/internal/memory/index-schema.ts — (MODIFY) add embeddings table + vec index
packages/sdk/src/internal/memory/sqlite-vec-loader.ts — (NEW) load extension at runtime
packages/sdk/src/internal/memory/index-manager.ts — (MODIFY) sync embeddings for new chunks
```

#### Tasks
1. Add `CREATE TABLE embeddings(chunk_id INTEGER PRIMARY KEY, vec_<dim> BLOB)` + `vec0` virtual table.
2. Load `sqlite-vec` extension via `db.loadExtension`.
3. During `sync()`, embed new chunks via configured provider, insert vectors.
4. **EC-1 (MUST FIX): persist embedding identity in a `meta` table.** Add `CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)`. Store `embedding.providerId`, `embedding.model`, `embedding.dimension` on first sync. On every subsequent open, compare current adapter config against stored meta — if any of the three changed, drop and recreate the `embeddings` table + vec0 index, then trigger a full re-embed sweep on next `sync()`. ~10 LoC.

#### TDD
```
RED:     vecIndex_stores_embedding_per_chunk() — sync → embeddings table has one row per chunk.
RED:     vecIndex_skips_unchanged_chunks() — re-sync with no file changes → 0 embedding calls.
RED:     vecIndex_handles_provider_failure_gracefully() — adapter throws → chunk indexed without vector, FTS still works, status.fallback="fts-only".
RED:     indexManager_force_reembed_on_dimension_change() — sync with `text-embedding-3-small` (1536) → switch config to `text-embedding-3-large` (3072) → next open drops embeddings + reembeds; meta table reflects new model (EC-1).
RED:     sqliteVecLoader_throws_typed_error_on_missing_extension() — stub `db.loadExtension` to throw → IndexManager surfaces `ConfigurationError(code: "sqlite_vec_unavailable")`, NOT a raw native error (EC-8).
GREEN:   Implement steps 1-4.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/vec-index.golden.test.ts
```

#### Acceptance Criteria
- [ ] 3 golden tests pass.

#### DoD
- [ ] sqlite-vec optional peer dep documented in package.json.

### T5.2 — Hybrid search scoring

#### Files to edit
```
packages/sdk/src/internal/memory/hybrid-search.ts — (NEW) combine FTS + vector scores
packages/sdk/src/internal/memory/index-manager.ts — (MODIFY) search() routes to hybrid when both indexes exist
```

#### Tasks
1. Implement `hybridSearch(query, { vectorWeight=0.6, textWeight=0.4, maxResults=10, minScore=0 })`.
2. Embed query once, run vector top-K + FTS top-K, normalize scores, combine, sort, return.

#### TDD
```
RED:     hybridSearch_blends_vector_and_text_scores() — known fixtures → exact ordering.
RED:     hybridSearch_respects_minScore() — filter below threshold.
RED:     hybridSearch_falls_back_to_fts_when_no_provider() — provider undefined → FTS-only, no errors.
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/hybrid-search.golden.test.ts
```

#### Acceptance Criteria
- [ ] 3 golden tests pass.

#### DoD
- [ ] `MemorySearchResult` includes `vectorScore` + `textScore` + combined `score`.

---

## Phase 6: `memory_search` + `memory_get` tools

**Objective:** Expose the two LLM-accessible tools matching OpenClaw schemas (D5).

### T6.1 — Tool registration

#### Files to edit
```
packages/sdk/src/internal/memory/tools.ts — (NEW) createMemorySearchTool, createMemoryGetTool
packages/sdk/src/internal/agent-loop/loop.ts — (MODIFY) collectTools includes memory tools when memory.enabled
```

#### Tasks
1. Implement `memory_search` tool: params `query: string`, `maxResults?: number`, `minScore?: number`, `corpus?: "memory"|"sessions"|"wiki"|"all"`. Returns ranked hits.
2. Implement `memory_get` tool: params `path: string`, `from?: number`, `lines?: number`, `corpus?`. Returns bounded excerpt.
3. Register in `collectTools` when `AgentOptions.memory.enabled === true` AND `memory.tools !== false`.
4. **EC-2 (MUST FIX): path-traversal guard in `memory_get`.** Resolve `path` against the memory root and call `isPathInside(memoryRoot, resolvedPath)`. On false, reject with `ConfigurationError(code: "memory_path_escapes_root")`. Mirror OpenClaw's `security-runtime` helper. ~3 LoC.
5. **EC-10 (SHOULD CAP): cap total result size in `memory_search`.** After ranking + filtering, if the concatenated snippet length exceeds `maxTotalChars` (default 16384), truncate the result list (drop low-rank hits first) and set `truncated: true` on the response.

#### TDD
```
RED:     memorySearchTool_returns_ranked_results() — stub adapter, query → ordered hits with citations.
RED:     memoryGetTool_returns_bounded_excerpt() — path + from/lines → exact lines, truncation info.
RED:     memoryTools_only_registered_when_enabled() — memory disabled → tools not in collectTools output.
RED:     memoryTools_corpus_filter_works() — corpus=wiki → only wiki hits.
RED:     memoryGetTool_rejects_path_traversal() — call with `path: "../../etc/passwd"` → throws `ConfigurationError(code: "memory_path_escapes_root")`; file is NOT read (EC-2).
RED:     memorySearchTool_caps_total_result_chars() — 100 chunks × 1000 chars, maxResults=100 → response stays ≤ 16384 chars; `truncated: true` set; lowest-rank hits dropped first (EC-10).
GREEN:   Implement steps 1-5.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/tools.golden.test.ts
```

#### Acceptance Criteria
- [ ] 4 golden tests pass.
- [ ] Stub-server golden test asserts the agent loop offers `memory_search` to the LLM when memory is enabled.

#### DoD
- [ ] Tool schemas mirror OpenClaw verbatim in `description` field.

---

## Phase 7: Active Memory blocking sub-agent

**Objective:** Per ADR D6 — a blocking sub-agent runs before each `send()`, calls memory tools, injects results.

### T7.1 — Active Memory runner

#### Files to edit
```
packages/sdk/src/internal/memory/active-memory.ts — (NEW) runs the sub-agent + result extraction
packages/sdk/src/internal/runtime/local-agent.ts — (MODIFY) call active memory before assembleSystemPromptForSend
packages/sdk/src/internal/runtime/system-prompt/types.ts — (MODIFY) SystemPromptAssemblyContext.activeMemoryResult
packages/sdk/src/internal/runtime/system-prompt/providers/active-memory-provider.ts — (NEW) priority 5 (before context)
```

#### Tasks
1. Implement `runActiveMemory({ userText, priorMessages, options }) → { summary: string | undefined; durationMs: number; status: "ok"|"timeout"|"skipped" }`.
2. The sub-agent is a `LocalAgent` constructed with: `memory.enabled=false` (no recursion), `systemPrompt` from a curated template, `tools` limited to `memory_search`/`memory_get`.
3. Apply query mode: `message` (only userText), `recent` (userText + last N turns), `full` (entire priorMessages).
4. Apply timeout (default 15000 ms) via `Promise.race` + abort signal.
5. Add `ActiveMemoryPromptProvider` (priority 5) that contributes the summary as a `<active-memory>` block.

#### TDD
```
RED:     activeMemory_calls_memory_search_with_user_query() — stub provider → captures the query.
RED:     activeMemory_respects_timeout() — slow stub → status "timeout", no crash.
RED:     activeMemory_returns_summary_within_budget() — known fixtures → summary length ≤ maxSummaryChars.
RED:     activeMemory_skips_when_disabled() — memory.activeRecall=false → status "skipped", no sub-agent call.
RED:     activeMemory_disables_recursion() — sub-agent's own memory.enabled stays false.
GREEN:   Implement steps 1-5.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/active-memory.golden.test.ts
```

#### Acceptance Criteria
- [ ] 5 golden tests pass.
- [ ] Stub-server E2E: agent with `activeRecall: true` shows `<active-memory>` block in the captured request body.

#### DoD
- [ ] No recursion (sub-agent doesn't trigger its own active-memory).
- [ ] Active-memory provider in default pipeline at priority 5.

---

## Phase 8: Circuit breaker + transcripts + cache

**Objective:** Active Memory hardened against repeated failures and duplicate calls.

### T8.1 — Circuit breaker + result cache

#### Files to edit
```
packages/sdk/src/internal/memory/circuit-breaker.ts — (NEW) consecutive-timeout counter + cooldown
packages/sdk/src/internal/memory/active-memory.ts — (MODIFY) wrap runActiveMemory in breaker + cache
packages/sdk/src/internal/memory/transcript-store.ts — (NEW) optional on-disk transcript persistence
```

#### Tasks
1. Implement breaker: `{ maxTimeouts: 3, cooldownMs: 60000 }`. After N consecutive timeouts, skip recall until cooldown.
2. Implement cache: `Map<sha256(userText+queryMode), { summary, expiresAt }>`. TTL default 15s.
3. Implement transcript store: write sub-agent transcripts under `.theokit/memory/transcripts/active-memory/<runId>.json` when `persistTranscripts: true`.

#### TDD
```
RED:     breaker_trips_after_max_timeouts() — 3 timeouts → 4th call skipped.
RED:     breaker_recovers_after_cooldown() — wait cooldown → calls resume.
RED:     cache_hits_skip_subagent_call() — same userText twice → 1 sub-agent call.
RED:     transcripts_persisted_when_enabled() — flag on → transcript file written.
RED:     transcripts_disabled_by_default() — no flag → no file.
GREEN:   Implement steps 1-3.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/breaker-and-cache.golden.test.ts
```

#### Acceptance Criteria
- [ ] 5 golden tests pass.

#### DoD
- [ ] All breaker/cache state in-process; no leaks across tests.

---

## Phase 9: Dreaming / REM consolidation

**Objective:** Cron-driven memory consolidation per ADR D7.

### T9.1 — Dreaming pipeline

#### Files to edit
```
packages/sdk/src/internal/memory/dreaming/phases.ts — (NEW) light/REM/deep phase definitions
packages/sdk/src/internal/memory/dreaming/narrative.ts — (NEW) summarize clusters via LLM
packages/sdk/src/internal/memory/dreaming/diary.ts — (NEW) write dream-diary.md entries
packages/sdk/src/internal/memory/dreaming/run.ts — (NEW) orchestrate a full sweep
packages/sdk/src/internal/cron/run-job.ts — (MODIFY) recognize `memory-dreaming` job kind
packages/sdk/src/types/agent.ts — (MODIFY) add `MemorySettings.dreaming`
```

#### Tasks
1. Implement phase definitions: light (dedup), REM (cluster + summarize), deep (rewrite into permanent notes).
2. Implement narrative summarization via a small dedicated LLM call.
3. Implement diary append (one markdown entry per sweep with timestamp + counts + actions).
4. Implement `runDreamingSweep({ cwd, config }) → DreamingResult`.
5. Wire to Cron: a job with `kind: "memory-dreaming"` calls `runDreamingSweep`.
6. **EC-3 (MUST FIX): all dreaming writes go through `replaceFileAtomic`.** Every mutation of `MEMORY.md`, `notes/*.md`, `dream-diary.md` writes to `<file>.tmp` + fsync + rename. Crash mid-sweep can leave SOME files updated and others not, but no individual file is half-written or empty. Reuse the same helper introduced in T1.1 step 5.

#### TDD
```
RED:     dreaming_dedups_near_duplicate_facts() — 2 semantically identical bullets → merged.
RED:     dreaming_clusters_thematically_related_facts() — known fixtures → fixed cluster IDs.
RED:     dreaming_writes_diary_entry() — sweep → dream-diary.md has new section.
RED:     dreaming_is_idempotent() — re-running same input → same diary hash.
RED:     dreaming_promotes_short_term_to_permanent() — facts marked short-term → moved to notes/.
RED:     dreaming_atomic_writes_survive_simulated_crash() — inject failure between two file writes via mocked fs.rename → no file is half-written; partial state is recoverable by re-running the sweep (EC-3).
GREEN:   Implement steps 1-6.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/dreaming.golden.test.ts
```

#### Acceptance Criteria
- [ ] 5 golden tests pass.
- [ ] `examples/cron-schedule` extended to demo a dreaming job firing.

#### DoD
- [ ] Dreaming uses existing Cron primitives; no new scheduler.

---

## Phase 10: Memory-wiki supplements

**Objective:** Read-only auxiliary corpora discoverable via `corpus=wiki`.

### T10.1 — Wiki supplement loader

#### Files to edit
```
packages/sdk/src/internal/memory/wiki-loader.ts — (NEW) load .theokit/memory/wiki/*.md
packages/sdk/src/internal/memory/tools.ts — (MODIFY) honor corpus=wiki/all in memory_search
```

#### Tasks
1. Discover wiki files under `.theokit/memory/wiki/`.
2. Index them into the same SQLite DB with `source="wiki"` tag.
3. Filter on tool calls.

#### TDD
```
RED:     wikiLoader_indexes_wiki_files() — wiki/*.md present → chunks have source=wiki.
RED:     memorySearch_corpus_wiki_returns_only_wiki_hits() — corpus=wiki → no memory/sessions hits.
RED:     memorySearch_corpus_all_returns_combined() — corpus=all → both memory and wiki hits.
GREEN:   Implement steps 1-3.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/wiki-loader.golden.test.ts
```

#### Acceptance Criteria
- [ ] 3 golden tests pass.

#### DoD
- [ ] Wiki corpus is read-only (no `memory_write_wiki` tool).

---

## Phase 11: Additional embedding adapters

**Objective:** Stub-implement Mistral, Voyage, DeepInfra, LMStudio, Google, Bedrock adapters with `not-implemented` errors initially; flesh out Mistral as a second working provider.

### T11.1 — Six provider stubs + Mistral implementation

#### Files to edit
```
packages/sdk/src/internal/memory/adapters/{mistral,voyage,deepinfra,lmstudio,google,bedrock}-embedding.ts — (NEW)
```

#### Tasks
1. Stub all 6 with metadata only (id, defaultModel, transport, authProviderId).
2. Implement Mistral fully (REST endpoint `/v1/embeddings`, similar shape to OpenAI).

#### TDD
```
RED:     allAdapters_export_correct_metadata() — id matches openclaw, defaultModel set.
RED:     mistralAdapter_embeds_text() — stub /v1/embeddings → vector returned.
RED:     stubAdapters_throw_not_implemented_on_embed() — others throw ConfigurationError code "adapter_not_implemented".
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/multi-adapter.golden.test.ts
```

#### Acceptance Criteria
- [ ] 3 golden tests pass.

#### DoD
- [ ] Switching provider via config is one field change.

---

## Phase 12: LanceDB alternative backend

**Objective:** Parity-feature: support LanceDB as an opt-in vector store.

### T12.1 — LanceDB backend

#### Files to edit
```
packages/sdk/src/internal/memory/backends/lancedb.ts — (NEW)
packages/sdk/src/internal/memory/index-manager.ts — (MODIFY) backend selector
```

#### Tasks
1. Wrap `@lancedb/lancedb` (optional peer dep).
2. Implement the same `IndexBackend` interface used by SQLite-vec.
3. Switching is `memory: { backend: "lancedb" }`.

#### TDD
```
RED:     lancedbBackend_indexes_chunks() — chunks added → searchable.
RED:     lancedbBackend_hybrid_search_returns_same_shape() — hits look identical to sqlite-vec backend.
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/memory/lancedb-backend.golden.test.ts
```

#### Acceptance Criteria
- [ ] 2 golden tests pass.

#### DoD
- [ ] LanceDB only loaded when backend selected (lazy import).

---

## Phase 13: Cross-validation

**Objective:** Verify implementation against OpenClaw reference shape.

### T13.1 — Cross-validation report

#### Files to edit
```
.claude/knowledge-base/reviews/cross-validation/memory-system-openclaw-parity-xval-<DATE>.md — (NEW)
```

#### Tasks
1. Compare each new module against the cited OpenClaw file. Note divergences with justification.
2. Verify all 10 ADRs against shipped code.
3. Classify any divergence per BLOCKER / CRITICAL / MAJOR / MINOR / INFO.

#### Acceptance Criteria
- [ ] Report saved with zero BLOCKERs.

#### DoD
- [ ] Every public surface mapped to its OpenClaw counterpart.

---

## Coverage Matrix

| # | Gap / Requirement | ADR | Task | Resolution |
|---|---|---|---|---|
| 1 | Markdown-first storage | D1 | T1.1 | MarkdownMemoryStore replaces JSON |
| 2 | Legacy JSON migration | D8 | T1.1 | One-shot migration helper |
| 3 | Chunking | — | T2.1 | chunkMarkdown |
| 4 | Bounded read | — | T2.1 | reader.readFile with truncation info |
| 5 | SQLite + FTS5 index | D2 | T3.1 | IndexManager |
| 6 | FTS-only fallback mode | D2 | T3.1 | backend="fts-only" |
| 7 | Embedding adapter contract | D3 | T4.1 | MemoryEmbeddingProviderAdapter |
| 8 | OpenAI embeddings | D3 | T4.2 | openai-embedding.ts |
| 9 | Embedding cache | — | T4.2 | LRU on hash |
| 10 | sqlite-vec vector index | D2 | T5.1 | vec0 virtual table |
| 11 | Hybrid scoring | D4 | T5.2 | hybridSearch |
| 12 | memory_search tool | D5 | T6.1 | createMemorySearchTool |
| 13 | memory_get tool | D5 | T6.1 | createMemoryGetTool |
| 14 | Active Memory sub-agent | D6 | T7.1 | runActiveMemory + provider |
| 15 | Circuit breaker | — | T8.1 | 3-timeout cooldown |
| 16 | Result cache | — | T8.1 | TTL 15s |
| 17 | Transcript persistence | — | T8.1 | transcript-store.ts |
| 18 | Dreaming consolidation | D7 | T9.1 | dreaming/run.ts |
| 19 | Dream diary | D7 | T9.1 | diary.ts |
| 20 | Wiki corpus | — | T10.1 | wiki-loader.ts |
| 21 | corpus=wiki/all filter | D5 | T10.1 | tools.ts honors corpus |
| 22 | 7 provider adapters | D3 | T11.1 | Stubs + Mistral live |
| 23 | LanceDB alt backend | D2 | T12.1 | lancedb.ts |
| 24 | Cross-validation | — | T13.1 | Report |
| 25 | Backward compat | D8 + D10 | T1.1 | Migration; Remember: still works |
| 26 | Session visibility filter | D9 | T3.1 | sessionKey column + filter |
| 27 | Citations | — | T3.1 + T6.1 | path:startLine-endLine attached to each hit |
| 28 | EC-1 (MUST FIX): embedding dimension mismatch corrupts index | D2 + D3 | T5.1 step 4 + TDD | meta table tracks providerId/model/dimension; drop+re-embed on change |
| 29 | EC-2 (MUST FIX): path traversal in memory_get | D5 | T6.1 step 4 + TDD | `isPathInside` guard rejects escaping paths |
| 30 | EC-3 (MUST FIX): dreaming mid-crash corrupts MEMORY.md | D7 | T9.1 step 6 + TDD | All dreaming writes via `replaceFileAtomic` |
| 31 | EC-4 (MUST FIX): concurrent appends race on MEMORY.md | D1 | T1.1 step 5 + TDD | Per-cwd mutex + atomic replace |
| 32 | EC-5 (SHOULD TEST): malformed MEMORY.md missing ## Facts | D1 | T1.1 TDD | New section created without losing prior content |
| 33 | EC-6 (SHOULD TEST): chunk split on word boundary | — | T2.1 TDD | Split at nearest whitespace ≤ maxChars |
| 34 | EC-7 (SHOULD TEST): corrupt SQLite DB recovery | D2 | T3.1 TDD | Rename aside + recreate schema, or typed error |
| 35 | EC-8 (SHOULD TEST): sqlite-vec extension load failure | D2 | T5.1 TDD | Typed `sqlite_vec_unavailable` ConfigurationError |
| 36 | EC-9 (SHOULD TEST): 5xx retry in embedding adapter | D3 | T4.2 TDD | Retry on 5xx with backoff (matches 429 pattern) |
| 37 | EC-10 (SHOULD CAP): memory_search result size cap | D5 | T6.1 step 5 + TDD | Default 16k char cap; drop low-rank hits first |
| 38 | EC-11 (DOCUMENT): Active Memory cache 15s staleness | D6 | T8.1 README | Note `cacheTtlMs: 0` opt-out in example |
| 39 | EC-12 (DOCUMENT): dreaming + send concurrency phantom-read | D7 | T9.1 README | Schedule dreaming during low-traffic windows |
| 40 | EC-13 (DOCUMENT): provider switch invalidates vectors | D3 | T11.1 docs | Re-embed cost note in adapter docs |

**Coverage: 40/40 (100%)**

## Global Definition of Done

- [ ] All 13 phases completed in order (or with documented exceptions for Phase 11/12 parallels).
- [ ] `pnpm typecheck` exits 0.
- [ ] All 188 pre-existing tests still pass.
- [ ] ~65 new tests across the phases pass (58 original + 7 edge-case regression tests).
- [ ] Zero Biome warnings.
- [ ] G1-G10 via `pnpm validate` exit 0.
- [ ] CHANGELOG entries for each phase under `[Unreleased]`.
- [ ] `examples/memory` upgraded to demonstrate: `memory_search` tool, `memory_get` tool, Active Memory recall, dreaming sweep.
- [ ] Cross-validation report saved with zero BLOCKERs.
- [ ] **Runtime-metric proof** — every phase has at least one golden test that proves observable behavior (chunk count, search hit count, breaker trip count, dreaming entries created). Per `.claude/rules/integration-first.md`.
- [ ] **Backward compatibility** — existing JSON memory files migrate cleanly; the `Remember:` trigger keeps working.
- [ ] **Bundle size budget** — core memory adds ≤ 200 KB to the SDK dist (excluding optional sqlite-vec native module).

## Final Phase: Dogfood QA (MANDATORY)

**Objective:** Run the full memory stack against real OpenRouter, exercising every public surface.

### Execution

```bash
# 1. Markdown storage + Remember: trigger
cd examples/memory && pnpm dev   # → MEMORY.md exists with the fact, agent-2 recalls

# 2. memory_search tool
cd ../memory-search && pnpm dev  # (NEW example added in Phase 6) → LLM calls memory_search, returns ranked hits

# 3. memory_get tool
cd ../memory-get && pnpm dev     # (NEW example) → LLM calls memory_get with bounded read

# 4. Active Memory
cd ../active-memory && pnpm dev  # (NEW example) → blocking sub-agent prepends <active-memory> block

# 5. Dreaming
cd ../memory-dreaming && pnpm dev # (NEW example) → cron job fires, dream-diary.md grows
```

### Acceptance Criteria

- [ ] All 5 examples print expected output.
- [ ] `MEMORY.md` exists and contains migrated + new facts in the run cwd.
- [ ] At least one `memory_search` invocation visible in the captured request body.
- [ ] Active-memory block appears in system prompt for the active-memory example.
- [ ] `dream-diary.md` has at least one entry after the dreaming example.
- [ ] All examples finish with `status=finished`.

### If Dogfood Fails

1. Identify which phase introduced the regression via git bisect on the phase commits.
2. Fix the failing acceptance criterion BEFORE declaring the plan complete.
3. Re-run the failing example after fix.
4. Pre-existing issues unrelated to this plan are logged but do not block completion.

---

## Honest scope caveat

Implementing OpenClaw memory verbatim, with full provider coverage, dreaming, two backends, and all edge cases, will land in **5-10 weeks** of focused engineering. The phase boundaries are designed so each one ships value independently — pause at any green checkpoint. If timeline pressure forces a cut, the most defensible MVP slice is **Phases 1-6** (markdown + index + tools), with Phases 7-9 (active memory + circuit breaker + dreaming) following next, and Phases 10-12 (wiki + extra adapters + LanceDB) as later iterations.
