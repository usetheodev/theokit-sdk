# Edge Case Review — memory-system-openclaw-parity

Data: 2026-05-16
Tasks analisadas: 13 (T1.1, T2.1, T3.1, T4.1, T4.2, T5.1, T5.2, T6.1, T7.1, T8.1, T9.1, T10.1, T11.1, T12.1)
Edge cases encontrados: 13 (MUST FIX: 4, SHOULD TEST: 6, DOCUMENT: 3)

Fronteiras analisadas:
- Disco: MEMORY.md + notes/*.md + .index/memory.sqlite + dream-diary.md + transcripts/
- Rede: OpenAI /v1/embeddings (+ 6 outros providers no Phase 11)
- LLM: sub-agent recall + dreaming narrative
- Concorrência: paralelos entre `agent.send` + dreaming cron + active-memory cache
- Native: sqlite-vec extension load
- User input: tool call args (`query`, `path`, `from`, `lines`)

---

## MUST FIX

### EC-1: Embedding dimension mismatch corrupts vector index when user swaps model

- **Task afetada:** T4.2 (OpenAI adapter), T11.1 (other providers)
- **Família:** State / Format
- **Cenário:** User runs with `model: "text-embedding-3-small"` (1536 dims), corpus indexed. Later switches to `"text-embedding-3-large"` (3072 dims) or to a different provider entirely. New queries embed at 3072 dims, but stored vectors are 1536. `sqlite-vec` cosine_distance silently returns garbage scores (the BLOB shapes mismatch — depending on the build either an error or a corruption of distance math). Either way, search ranks become meaningless.
- **Impacto:** Silent search-result corruption. Users see "memory search is broken" with no clear cause.
- **Fix sugerido:** Persist `embedding.providerId` + `embedding.model` + `embedding.dimension` in a `meta` table during the first `sync()` write. On subsequent opens, if any of the three changed, drop the `embeddings` table and force a full re-embed sweep. Single `if` block + one extra table; ~10 LoC in `index-manager.ts`. Add T5.1 sub-task and TDD test `indexManager_force_reembed_on_dimension_change`.

### EC-2: Path traversal in `memory_get(path="../../etc/passwd")`

- **Task afetada:** T6.1 (memory_get tool)
- **Família:** Permission / Security
- **Cenário:** The LLM (or a malicious user crafting a tool call) passes a relative path that escapes the memory root via `..`. `memory_get` would happily read any file the SDK process has access to.
- **Impacto:** Arbitrary file read by the LLM. Real security hole, especially when the SDK runs inside containers with mounted user secrets.
- **Fix sugerido:** Wrap the resolved path in `isPathInside(memoryRoot, resolvedPath)` (OpenClaw exports this helper at `openclaw/plugin-sdk/security-runtime`). Reject with `ConfigurationError(code: "memory_path_escapes_root")` when false. 3 LoC. Add to T6.1 Tasks and TDD test `memoryGetTool_rejects_path_traversal`.

### EC-3: Dreaming sweep mid-crash corrupts MEMORY.md

- **Task afetada:** T9.1 (Dreaming run.ts)
- **Família:** State / Crash recovery
- **Cenário:** Dreaming reads N facts, clusters them, then rewrites `MEMORY.md` and `notes/*.md` with the consolidated output. If process crashes (SIGKILL, power loss, OOM) between the `.write()` syscalls for two files, the corpus is half-rewritten: some notes consolidated, others still pointing to the pre-sweep facts. Re-running dreaming doesn't restore the lost intermediate state.
- **Impacto:** Permanent loss of memory facts. Worse than a missed dream cycle.
- **Fix sugerido:** Use the same `replaceFileAtomic` pattern OpenClaw uses (`packages/memory-host-sdk/src/host/fs-utils.ts`): write each output to `<file>.tmp`, fsync, then rename. All renames inside a single sweep happen sequentially, but each individual file mutation is atomic. Crash mid-sweep leaves SOME files updated and others not, but no file is half-written. Add to T9.1 Tasks and TDD test `dreaming_atomic_writes_survive_simulated_crash`.

### EC-4: Concurrent `agent.send("Remember: …")` calls race on MEMORY.md (worse than the JSON case)

- **Task afetada:** T1.1 (MarkdownMemoryStore)
- **Família:** Concurrency / State
- **Cenário:** Two parallel sends both append a fact. The markdown writer reads MEMORY.md, splices in a new bullet, writes the whole file back. The second write overwrites the first's change. This already existed for JSON (we documented EC-6 in v1-completeness), but markdown is worse because the file footprint is bigger — a partial write of a half-rendered markdown structure is uglier than a half-JSON.
- **Impacto:** Silently dropped facts in parallel scenarios (parallel sub-agents, multi-process workspaces).
- **Fix sugerido:** Use atomic file replace (`replaceFileAtomic`) for every append, PLUS an in-process write mutex per `cwd` (Map<cwd, Promise> serialization). 6 LoC. Add to T1.1 Tasks and TDD test `markdownStore_serializes_concurrent_appends`. Multi-process safety stays a v2 problem (file lock or SQLite-backed metadata) — DOCUMENT it.

---

## SHOULD TEST

### EC-5: User-edited MEMORY.md is structurally malformed (no `## Facts` section)

- **Task afetada:** T1.1
- **Teste sugerido:** `markdownStore_creates_facts_section_when_missing()` — pre-populate MEMORY.md with only `# Title\n\nrandom text`; append a fact; assert the result has a new `## Facts` section AND preserves the original content.

### EC-6: Word-boundary split when paragraph > maxChars

- **Task afetada:** T2.1 (chunkMarkdown)
- **Teste sugerido:** `chunkMarkdown_splits_on_word_boundary_not_mid_word()` — paragraph of 1500 chars with no whitespace at exact 800th char → split point is the nearest whitespace ≤ maxChars, not exactly at 800. Mid-word split would produce gibberish tokens for FTS.

### EC-7: SQLite DB corrupt on open → IndexManager rebuilds from scratch

- **Task afetada:** T3.1
- **Teste sugerido:** `indexManager_recovers_from_corrupt_db()` — write garbage to `.index/memory.sqlite`; open IndexManager; assert it either renames the corrupt file aside (`.corrupt-<ts>`) AND recreates the schema, OR throws a typed `ConfigurationError(code: "index_corrupt")`. Plan mentions "read-only recovery mode" but no test pins the contract.

### EC-8: sqlite-vec extension fails to load (binary missing or arch mismatch)

- **Task afetada:** T5.1
- **Teste sugerido:** `sqliteVecLoader_throws_typed_error_on_missing_extension()` — stub `db.loadExtension` to throw; assert IndexManager surfaces `ConfigurationError(code: "sqlite_vec_unavailable")` with a clear message ("install sqlite-vec or set memory.backend=fts-only"), NOT a raw native error.

### EC-9: HTTP 5xx during embedding batch → retry vs propagate

- **Task afetada:** T4.2
- **Teste sugerido:** `openaiAdapter_retries_on_5xx_with_backoff()` — stub returns 503 once, then 200. Adapter retries (max 2) before propagating. Plan today only mentions 429; 5xx is the more common failure mode for embedding endpoints.

### EC-10: `memory_search` tool returns oversized result blob that blows the LLM context

- **Task afetada:** T6.1
- **Teste sugerido:** `memorySearchTool_caps_total_result_chars()` — corpus with 100 chunks of 1000 chars each, `maxResults: 100` → output capped at `maxTotalChars` (default 16k); excess hits truncated with `truncated: true` marker. Without this cap, agents with rich memory regularly OOM the context window.

---

## DOCUMENT

### EC-11: Active Memory cache TTL serves stale summary for 15s after memory mutation

- **Task afetada:** T8.1
- **Risco aceito:** Cache keyed by `sha256(userText + queryMode)`. If between two identical sends the underlying memory changed (another agent wrote, dreaming ran), the second send gets the previous send's cached summary. 15s TTL is short enough that this is a rare corner; invalidating-on-write would require coupling write paths to cache state. Document in `examples/active-memory/README.md`: "Active Memory results are cached 15s per query+mode; if you need real-time freshness, disable cache via `cacheTtlMs: 0`."

### EC-12: Dreaming running concurrently with `agent.send()` produces a phantom-read

- **Task afetada:** T9.1
- **Risco aceito:** Dreaming rewrites the corpus mid-conversation. A `send()` whose recall fired before dreaming finishes will see pre-sweep facts; the next `send()` sees post-sweep facts. The agent's mental model briefly drifts. Fixing requires a read-write lock around the whole memory corpus + index, which is heavyweight for v1. Document in `examples/memory-dreaming/README.md`: "Schedule dreaming during low-traffic windows (cron defaults to 03:00). Concurrent send + dreaming may produce one transitional turn with mixed-view facts."

### EC-13: Switching embedding provider mid-workspace invalidates ALL stored vectors

- **Task afetada:** T11.1
- **Risco aceito:** Covered structurally by EC-1's fix (detect change + force reembed). What's left to document: re-embedding 10k chunks against a new provider costs real money + minutes of latency. Document in the embedding adapter docs: "Changing `memory.embedding.provider` or `model` triggers a full corpus re-embed. Estimated cost: ~$0.02 per 1k chunks for OpenAI; budget accordingly. The SDK does NOT auto-rollback if the new provider fails — the old index is dropped first by design (no dual-store complexity)."

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1 | 2 | 1 (EC-4) | 1 (EC-5) | 0 |
| T2.1 | 1 | 0 | 1 (EC-6) | 0 |
| T3.1 | 1 | 0 | 1 (EC-7) | 0 |
| T4.2 | 2 | 1 (EC-1) | 1 (EC-9) | 0 |
| T5.1 | 1 | 0 | 1 (EC-8) | 0 |
| T6.1 | 2 | 1 (EC-2) | 1 (EC-10) | 0 |
| T7.1 | 0 | 0 | 0 | 0 |
| T8.1 | 1 | 0 | 0 | 1 (EC-11) |
| T9.1 | 2 | 1 (EC-3) | 0 | 1 (EC-12) |
| T10.1 | 0 | 0 | 0 | 0 |
| T11.1 | 1 | 0 | 0 | 1 (EC-13) |
| T12.1 | 0 | 0 | 0 | 0 |

**Veredicto:** PLANO PRECISA DE AJUSTE

Quatro MUST FIX, todos com fix em ≤10 LoC ou ≤1 estratégia de write:

- **EC-1** — `meta` table com providerId+model+dimension; drop+re-embed on change. Phase 5 ganha 1 sub-task + 1 test.
- **EC-2** — `isPathInside` guard no `memory_get`. Phase 6 ganha 1 step + 1 test.
- **EC-3** — `replaceFileAtomic` em todo write do dreaming. Phase 9 ganha 1 step + 1 test.
- **EC-4** — write mutex por cwd + atomic replace no append. Phase 1 ganha 1 step + 1 test.

Six SHOULD TEST se absorvem nos TDD lists existentes (1 teste por phase afetada).

Three DOCUMENT são limites conscientes do escopo v1 — vão em READMEs dos exemplos correspondentes (active-memory, memory-dreaming, embedding adapter docs).

**Nenhum edge case justifica nova abstração, nova classe, ou retry/lock/coordination infra além do que o plano já tem.** Todos resolvem com `if` / atomic-rename / type-check / nota em doc — alinhado à filosofia KISS do skill.

### Próximo passo

Incorporar os 4 MUST FIX no plano principal antes de qualquer implementação. Adicionar 1 sub-step + 1 RED test em cada phase afetada (1, 5, 6, 9). SHOULD TESTs entram nos TDD lists existentes de cada phase. DOCUMENTs ficam pendurados como "v1 limitations" nos READMEs dos exemplos.
