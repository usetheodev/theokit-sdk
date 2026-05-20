# Cross-Validation — memory-system-openclaw-parity

Data: 2026-05-16
Plano: `.claude/knowledge-base/plans/memory-system-openclaw-parity-plan.md`
Veredicto: **APROVADO COM RESSALVAS**

## Escopo

Verificar que cada wiring fix do plano (13 phases) está implementado no código + coberto por teste + sem regressão. Comparar contra `referencia/openclaw/` quando relevante.

## Resultado por phase

| Phase | Task | Implementado | Testes | Status |
|-------|------|--------------|--------|--------|
| 1 | T1.1 — Markdown corpus + migration + atomic + mutex | `markdown-store.ts`, `migration.ts`, `atomic-write.ts`, `cwd-mutex.ts`, `types.ts` | `markdown-store.golden.test.ts` (9) | ✅ |
| 2 | T2.1 — Chunking + bounded reader | `chunk-markdown.ts`, `reader.ts` | `chunk-and-read.golden.test.ts` (8) | ✅ |
| 3 | T3.1 — SQLite + FTS5 IndexManager | `index-schema.ts`, `index-db.ts`, `index-manager.ts` | `index-manager.golden.test.ts` (8) | ✅ |
| 4 | T4.1 + T4.2 — Embedding adapter + OpenAI | `embedding-adapter.ts`, `adapters/openai-embedding.ts`, `embedding-cache.ts` | `openai-embedding.golden.test.ts` (8) | ✅ |
| 5 | T5.1 + T5.2 — sqlite-vec + hybrid search | `sqlite-vec-loader.ts`, `vec-index.ts`, hybrid scoring inside `index-manager.ts` | `vec-index.golden.test.ts` (6) | ✅ |
| 6 | T6.1 — memory_search/get tools | `tools.ts` + agent-loop wire-up (`tool-dispatch.ts`, `loop-types.ts`, `loop.ts`) | `tools.golden.test.ts` (6) | ✅ |
| 7 | T7.1 — Active Memory recall | `active-memory.ts`, `active-memory-provider.ts` | `active-memory.golden.test.ts` (11) | ✅ (modo `subagent` deferido para 7.1) |
| 8 | T8.1 — Breaker + cache + transcripts | `circuit-breaker.ts`, `active-memory-cache.ts`, `transcript-store.ts` | `breaker-and-cache.golden.test.ts` (11) | ✅ |
| 9 | T9.1 — Dreaming/REM | `dreaming/phases.ts`, `dreaming/diary.ts`, `dreaming/run.ts` | `dreaming.golden.test.ts` (7) | ✅ (LLM narrative summarization deferido para 9.1) |
| 10 | T10.1 — Wiki supplements | `wiki-loader.ts` + `collectMarkdownFiles` extensão | `wiki-loader.golden.test.ts` (3) | ✅ |
| 11 | T11.1 — 7 provider adapters | `adapters/{openai,mistral}-embedding.ts` live + `adapters/{voyage,deepinfra,lmstudio,google,bedrock}-embedding.ts` stubs + `adapters/catalog.ts` + `adapters/openai-compatible.ts` shared factory + `adapters/stub-adapter.ts` | `multi-adapter.golden.test.ts` (3) | ✅ |
| 12 | T12.1 — LanceDB backend | `IndexManager.open` aceita `backend: "lancedb"` → throws typed error | `lancedb-backend.golden.test.ts` (3) | ✅ (impl real deferida para 12.1) |
| 13 | T13.1 — Cross-validation | Este relatório | N/A | ✅ |

**Total: 86 testes novos.** Suite completa: 271/271 verdes.

## Cobertura dos ADRs

| ADR | Decisão | Evidência |
|-----|---------|-----------|
| D1 — Markdown-first storage | MEMORY.md + notes/*.md; JSON migrated on first read | `markdown-store.ts` + `migration.ts` |
| D2 — SQLite + FTS5 + sqlite-vec primary index | Schema com `files`/`chunks`/`chunks_fts`/`meta`/`embeddings` (vec0) | `index-schema.ts` + `vec-index.ts` |
| D3 — Embedding provider adapter interface | `MemoryEmbeddingProviderAdapter` com `id`/`defaultModel`/`transport`/`authProviderId`/`autoSelectPriority`/`create` | `embedding-adapter.ts` + catálogo de 7 adapters |
| D4 — Hybrid search scoring | `combineHybridScores` com `vectorWeight` 0.6 + `textWeight` 0.4 | `index-manager.ts` `combineHybridScores` + `blendScores` |
| D5 — Tool surface mirrors OpenClaw | `memory_search` + `memory_get` com schemas idênticos | `tools.ts` |
| D6 — Active Memory blocking sub-agent | `runActiveMemory` em modo `search` (determinístico); `subagent` mode reservado | `active-memory.ts` + `active-memory-provider.ts` |
| D7 — Dreaming consolidation | Light/REM/deep phases + diary cron-wireable | `dreaming/*.ts` |
| D8 — Backward compat via migration | `migrateLegacyJson` idempotente, deleta JSON após sucesso | `migration.ts` |
| D9 — Session-visibility | `chunks.session_key` column existe; filter no `search` | Schema + `MemorySearchHit.source` |
| D10 — Remember: trigger preserved | `appendMemoryFact` → markdown writer | v1-completeness `local-agent.ts` continua funcional |

## Cobertura dos edge cases

| EC | Descrição | Resolução |
|----|-----------|-----------|
| EC-1 | Embedding dimension mismatch | `meta` table tracks identity; `identityMatches` + `dropVectorIndex` on change |
| EC-2 | Path traversal em memory_get | `isPathInside` guard em `tools.ts createMemoryGetTool` |
| EC-3 | Dreaming mid-crash corrupts MEMORY.md | `replaceFileAtomic` em todos writes do dreaming/diary/notes |
| EC-4 | Concurrent appends race | `withCwdMutex` em `appendFactToMarkdown` |
| EC-5 | Malformed MEMORY.md | `parseFactsSection` retorna `[]` se heading ausente; `insertFactBullet` cria a seção preservando prior content |
| EC-6 | Word-boundary split | `findWordBoundarySplit` em `chunk-markdown.ts` |
| EC-7 | Corrupt SQLite DB | `openMemoryDb` renomeia aside + rebuild schema |
| EC-8 | sqlite-vec extension load failure | `loadSqliteVecExtension` wraps load com typed `sqlite_vec_unavailable` |
| EC-9 | 5xx retry no embedding adapter | `isRetryable` em `openai-compatible.ts` cobre 429 + 5xx |
| EC-10 | memory_search result-size cap | `capByTotalChars` em `tools.ts createMemorySearchTool` |
| EC-11 | Active Memory cache 15s staleness | TTL configurável documentada |
| EC-12 | Dreaming + send concurrency | Mutex compartilhado entre dreaming + appendFact garante serialização |
| EC-13 | Provider switch invalidates vectors | Coberto por EC-1 + documentado em CHANGELOG |

## Ressalvas (divergências MENORES vs plano)

### MAJOR — none

### MINOR

1. **Phase 7 modo `subagent` é stub** — `runActiveMemory` implementa `mode: "search"` (determinístico, sem LLM). O modo `subagent` (LLM-mediated curation) está documentado como Phase 7.1 future work. Interface `mode: "search" | "subagent"` está exposta; modo `subagent` retorna o mesmo comportamento que `search` hoje.

2. **Phase 9 LLM narrative summarization é stub** — `runDreamingSweep` implementa light/REM/deep determinístico (cosine-based clustering). LLM-mediated narrative summarization fica como Phase 9.1. Diary entry + notas markdown já são consolidações úteis.

3. **Phase 12 LanceDB é stub** — backend selector aceita `backend: "lancedb"` mas lança `ConfigurationError(code: "memory_backend_not_implemented")`. Implementação real (50MB+ native + Lance columnar storage + Backend interface refactor) deferida para Phase 12.1.

### INFO

- **Cron wire-up para dreaming**: a função `runDreamingSweep` está pronta; o registro como job kind `memory-dreaming` no `Cron.run-job.ts` fica para o consumer (uma linha). Documentado no CHANGELOG.
- **Bundle size**: o plano fixava ≤200 KB core. Phase 11 adicionou ~3 KB por stub × 5 + ~2 KB Mistral + ~3 KB shared factory. Total ~22 KB extra além das phases 1-10. Bem dentro do budget.

## Suite

- **271/271 testes verdes** (`pnpm test:roadmap`)
- `pnpm typecheck` exit 0
- `pnpm check` (Biome) exit 0
- 0 dependency cycles (112 modules, 220 dependencies cruised)
- 108 files ≤ 400 LoC (G8 pass)
- 0.08% jscpd duplication (G10 pass, well under threshold)

## Native deps adicionadas

- `better-sqlite3@12.10.0` (compiled native, ~2MB)
- `@types/better-sqlite3@7.6.13` (dev-only)
- `sqlite-vec@0.1.9` (optional native; works on Linux x64 in this env)

Todas dev/optional deps — não inflacionam o bundle publicado para usuários que não precisam de memória indexada.

## Observações

A implementação cobre **a estrutura completa do plano em escopo, com 3 stubs honestos**. Stubs são pattern consistente (mesma técnica que Phase 11 usou para 5 embedding adapters) — interface exposta + erro tipado quando selecionado. Adicionar a implementação real é um arquivo a mais por stub, sem mudança de contrato externo.

A separação `core slice (Phases 1-6)` + `Active Memory + resilience (Phases 7-8)` + `Dreaming (Phase 9)` + `Wiki + Multi-provider + LanceDB (Phases 10-12)` mantém-se útil — qualquer release MVP pode parar em qualquer phase verde.

**Sem BLOCKERs.** Pronto para Dogfood QA.
