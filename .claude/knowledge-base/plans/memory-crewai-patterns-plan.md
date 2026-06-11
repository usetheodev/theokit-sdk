# Plan: Memory System Upgrade — CrewAI-Inspired Patterns

> **Version 1.1** — Adds 4 CrewAI-inspired memory capabilities to `@theokit/sdk-memory`: batch encoding pipeline (`rememberMany`), composite scoring with recency decay, query analysis for adaptive recall, and hierarchical scopes. Informed by the deep analysis of CrewAI's `unified_memory.py` encoding/recall flows.

## Goal

> "Ship 4 memory upgrades (batch encoding, composite scoring, query analysis, hierarchical scopes) in `@theokit/sdk-memory` so that memory saves are 10x cheaper (batch embed), recall ranks recent memories higher (composite score), complex queries produce better results (sub-query distillation), and multi-agent setups have fine-grained memory isolation (scope paths), measured by `pnpm --filter @theokit/sdk-memory exec vitest run` exit 0 with 40+ new tests."

## Context

The 2026-06-10 cross-validation deep dive into CrewAI's memory system identified 5 learnable patterns. The user selected P1-P4 for implementation. CrewAI's `unified_memory.py` (1060 LoC) + `encoding_flow.py` (300 LoC) + `recall_flow.py` (100 LoC) demonstrate a mature memory architecture with batch-native encoding, composite scoring, and hierarchical scoping. TheoKit already has strong foundations (12 embedding providers, dual vector backends, dreaming, circuit breaker, query cache) — these 4 upgrades layer on top without replacing existing functionality.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/sdk-memory/src/internal/index-schema.ts` | 60 | `540b570` (2026-06-10) | SQLite schema (files, chunks, chunks_fts, meta tables) | Backward-compat: migration adds columns, never drops |
| `packages/sdk-memory/src/internal/index-manager.ts` | ~450 | `540b570` (2026-06-10) | Core index: sync, search, embedMissing | Keep existing sync() + search() APIs |
| `packages/sdk-memory/src/internal/active-memory.ts` | ~310 | `540b570` (2026-06-10) | Pre-send recall with circuit breaker | Keep blocking recall + query modes |
| `packages/sdk-memory/src/internal/active-memory-types.ts` | ~50 | `540b570` (2026-06-10) | Types for active memory | Extend with new config options |
| `packages/sdk-memory/src/internal/migration.ts` | ~80 | `540b570` (2026-06-10) | Schema migration logic | Add migration v2 for new columns |
| `packages/sdk-memory/src/internal/batch-encoder.ts` (NEW) | 0 | — | Batch encoding pipeline | — |
| `packages/sdk-memory/src/internal/composite-scorer.ts` (NEW) | 0 | — | Composite scoring with recency decay | — |
| `packages/sdk-memory/src/internal/query-analyzer.ts` (NEW) | 0 | — | LLM-driven query analysis | — |
| `packages/sdk-memory/src/internal/memory-scope.ts` (NEW) | 0 | — | Hierarchical scope support | — |
| `packages/sdk-memory/tests/batch-encoder.test.ts` (NEW) | 0 | — | — | — |
| `packages/sdk-memory/tests/composite-scorer.test.ts` (NEW) | 0 | — | — | — |
| `packages/sdk-memory/tests/query-analyzer.test.ts` (NEW) | 0 | — | — | — |
| `packages/sdk-memory/tests/memory-scope.test.ts` (NEW) | 0 | — | — | — |

### Current callers / dependents

- **`IndexManager.search()`** — called by `active-memory.ts:runActiveMemory` → agent loop. All recall paths flow through here. Adding composite scoring changes ranking but not API shape.
- **`IndexManager.sync()`** — called by `Memory.openIndex()` at agent startup. Batch encoder is a NEW path alongside sync, not a replacement.
- **`SCHEMA_STATEMENTS`** — consumed by `index-db.ts:openDb()`. Migration must be backward-compatible (ALTER TABLE ADD COLUMN).
- **`EmbeddingRuntime.embed()`** — current API accepts single string. Need to verify batch support (`embed(texts: string[])`) already exists.

### Domain glossary

- **Batch encoding** — embedding N texts in one API call instead of N separate calls
- **Composite scoring** — blending vector similarity + text match + recency decay + importance into one ranking score
- **Query analysis** — using LLM to decompose a complex query into targeted sub-queries before embedding
- **Hierarchical scope** — path-based memory isolation (e.g., `/crew/agent-1/long-term`) instead of flat enum
- **Recency decay** — exponential half-life function: `0.5^(age/halfLife)` reduces old memories' scores

### Architecture boundaries affected

- **sdk-memory internal** — all 4 features are internal modules. No new public sub-path exports needed.
- **Schema migration** — adds columns to existing SQLite table. Backward-compatible (NULL defaults).
- **EmbeddingRuntime** — must need batch `embed(texts[])` if not already present (verify).

## Prior Art & Related Work

- **CrewAI `encoding_flow.py`** — 5-stage batch pipeline: batch embed → intra-batch dedup → parallel find-similar → parallel analyze → execute plans. Reference at `referencia/crewai/` (not cloned locally but analyzed via `/tmp/crewai-ref`).
- **CrewAI `unified_memory.py`** — composite scoring: `semantic_weight * sim + recency_weight * decay + importance_weight * importance`. Lines 345-381.
- **CrewAI `recall_flow.py`** — adaptive recall with LLM-driven sub-query distillation, scope suggestion, time filtering.
- **Existing TheoKit dreaming** — `sdk-memory/src/internal/dreaming-phases.ts` — light/REM/deep phases for batch consolidation (reusable foundation for batch encoder).

## Objective

- [ ] Verify `rememberMany(texts[])` batch-encodes in 1 API call with intra-batch dedup, confirmed by 10+ tests
- [ ] Verify `compositeScore()` blends semantic + recency + importance, confirmed by 8+ tests
- [ ] Verify `analyzeQuery()` produces sub-queries for long inputs, confirmed by 6+ tests
- [ ] Verify `MemoryScope` enables hierarchical path-based isolation, confirmed by 8+ tests
- [ ] Verify schema migration adds `created_at`, `importance`, `scope` columns to chunks table
- [ ] Run `pnpm --filter @theokit/sdk-memory exec vitest run` exit 0 with 40+ new tests

## ADRs

### D1 — Batch encoder as new module, not replacement for sync()

**Decision:** `rememberMany()` is a new method on `IndexManager` alongside existing `sync()`. sync continues to work for file-based indexing; rememberMany handles programmatic batch saves.

**Rationale:** Per OCP (`architecture.md`): extend without modifying. Existing sync() callers (agent startup) are unaffected. Per KISS: two entry points for two use cases is simpler than merging them.

**Alternatives considered:**
- **(A) Replace sync() with batch encoder** — rejected: sync() indexes files from disk; batch encoder saves in-memory texts. Different inputs, different lifecycles.

**Consequences:** Two indexing paths coexist. Both share the same chunks table + embedding infrastructure.

### D2 — Composite scoring as pluggable scorer, not hardcoded

**Decision:** `compositeScore(hit, config)` is a pure function that replaces the current inline `vectorWeight * vectorScore + textWeight * textScore`. Config exposes `semanticWeight`, `textWeight`, `recencyWeight`, `importanceWeight`, `recencyHalfLifeDays`.

**Rationale:** Per SRP: scoring is a separate concern from search. Per DIP: the scorer is injectable — callers can customize weights.

**Alternatives considered:**
- **(A) Hardcode CrewAI's weights** — rejected: different use cases need different weights. A config object is more flexible.

**Consequences:** Default weights: semantic 0.5, text 0.2, recency 0.2, importance 0.1. Backward-compatible: old behavior reproduced with `{semanticWeight: 0.6, textWeight: 0.4, recencyWeight: 0, importanceWeight: 0}`.

### D3 — Query analysis opt-in, not default

**Decision:** Query analysis (LLM sub-query distillation) is opt-in via `search({ analyzeQuery: true })` or auto-triggered when query length > 250 chars. When off, existing embed-directly path is used.

**Rationale:** Per YAGNI: most queries are short. LLM call adds latency + cost. Per KISS: simple queries don't need analysis.

**Alternatives considered:**
- **(A) Always analyze** — rejected: adds ~500ms latency + 1 LLM call to every search. Most recalls are < 50 chars.

**Consequences:** Short queries: zero additional cost. Long queries: +1 LLM call but better results.

### D4 — Hierarchical scopes via path column, not separate tables

**Decision:** Add `scope TEXT DEFAULT '/'` column to chunks table. Scope is a path string (e.g., `/crew/research/facts`). Search filters by prefix match (`scope LIKE '/crew/research/%'`).

**Rationale:** Per KISS: one column with prefix matching is simpler than a scope table with joins. Per DRY: path semantics are well-understood (filesystem, URL routing).

**Alternatives considered:**
- **(A) Separate scope table with foreign key** — rejected: adds join complexity for a feature that's essentially a tag filter.

**Consequences:** Schema migration adds column. Existing data gets default scope `/`. Backward-compatible.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Schema migration on existing DBs must fail if DB is locked | Medium | Migration runs inside transaction with retry. Existing data preserved with NULL defaults. | Phase 1 |
| Composite scoring changes ranking order — must surprise existing users | Medium | Old behavior reproducible with legacy weights config. Default weights tuned empirically. | Phase 2 |
| Query analysis adds LLM cost for long queries | Low | Opt-in only; auto-trigger only for queries > 250 chars. Budget-aware: respects agent budget if set. | Phase 3 |

## Unresolved Questions

- Q1: Does `EmbeddingRuntime.embed()` already accept `string[]` for batch? Need to verify. If not, add overload.

## Dependency Graph

```
Phase 1 (Schema migration) ──▶ Phase 2 (Batch encoder) ──▶ (parallel)
                               Phase 3 (Composite scoring) ──▶ Phase 5 (Validation)
                               Phase 4 (Query analysis + Scopes) ──▶ Phase 5
```

Phases 3 and 4 can run in parallel after Phase 1. Phase 2 depends on Phase 1 (new columns).

---

## Phase 1: Schema Migration

**Objective:** Add `created_at`, `importance`, `scope` columns to chunks table.

### T1.1 — Schema migration v2

#### Objective
Add 3 new columns to the chunks table for composite scoring + scoping.

#### Why this step
1. **What:** Add `created_at INTEGER`, `importance REAL DEFAULT 0.5`, `scope TEXT DEFAULT '/'` to chunks table via ALTER TABLE.
2. **Why now:** All 4 features depend on these columns. Per ADR D4: scope is a path column. Per ADR D2: importance enables weighted scoring.

#### Evidence
- `index-schema.ts` has no `created_at`, `importance`, or `scope` columns (verified)
- `migration.ts` exists with v1 migration logic — extend with v2

#### Files to edit
```
packages/sdk-memory/src/internal/index-schema.ts — add columns to CREATE TABLE + migration SQL
packages/sdk-memory/src/internal/migration.ts — add v2 migration
packages/sdk-memory/tests/migration-v2.test.ts (NEW) — migration tests
```

#### Deep file dependency analysis
- `index-schema.ts`: consumed by `index-db.ts:openDb()`. Adding columns is additive.
- `migration.ts`: runs ALTER TABLE for existing DBs. Must be idempotent (IF NOT EXISTS / try-catch).

#### Tasks
1. Add `created_at INTEGER` (nullable — EC-2), `importance REAL DEFAULT 0.5`, `scope TEXT DEFAULT '/'` to SCHEMA_STATEMENTS
2. Add v2 migration to migration.ts: ALTER TABLE chunks ADD COLUMN for each (all nullable — existing rows get NULL/default)
3. Write migration tests

#### TDD
```
RED:     test_migration_v2_adds_created_at() — verify column exists after migration
RED:     test_migration_v2_adds_importance_with_default() — default 0.5
RED:     test_migration_v2_adds_scope_with_default() — default "/"
RED:     test_migration_v2_idempotent() — running twice does not throw
RED:     test_existing_data_preserved() — data before migration survives
GREEN:   Implement migration
VERIFY:  pnpm --filter @theokit/sdk-memory exec vitest run tests/migration-v2.test.ts
```

#### Acceptance Criteria
- [ ] Verify `SELECT created_at, importance, scope FROM chunks LIMIT 1` succeeds after migration
- [ ] Verify existing chunks get `importance=0.5`, `scope='/'`, `created_at=NULL`
- [ ] Run `pnpm --filter @theokit/sdk-memory exec vitest run tests/migration-v2.test.ts` and confirm 5+ tests pass

#### DoD
- [ ] Run tests and confirm 5+ pass
- [ ] Run `pnpm --filter @theokit/sdk-memory exec tsc --noEmit` and confirm exit 0

---

## Phase 2: Batch Encoding Pipeline

**Objective:** Ship `rememberMany()` that batch-encodes texts with dedup.

### T2.1 — Batch encoder with intra-batch dedup

#### Objective
Create batch encoding module that embeds N texts in 1 API call and deduplicates within the batch.

#### Why this step
1. **What:** Create `batch-encoder.ts` with `rememberMany(texts, opts)` that: (a) embeds all texts in one `embed(texts[])` call, (b) cosine-similarity dedup within batch (threshold 0.95), (c) inserts surviving chunks with `created_at`, `importance`, `scope`.
2. **Why now:** Per ADR D1: new module alongside sync(). CrewAI proves 10x cost reduction. The existing `embedMissingChunks` embeds one-by-one.

#### Evidence
- CrewAI `encoding_flow.py` Stage 1-2: batch embed + intra-batch dedup
- Current `embedMissingChunks` in `index-manager.ts` embeds individually

#### Files to edit
```
packages/sdk-memory/src/internal/batch-encoder.ts (NEW) — rememberMany + intra-batch dedup
packages/sdk-memory/tests/batch-encoder.test.ts (NEW) — tests
```

#### Deep Dives

```typescript
export interface RememberManyOptions {
  scope?: string;        // default: "/"
  importance?: number;   // default: 0.5
  dedupThreshold?: number; // default: 0.95
}

export interface RememberManyResult {
  total: number;
  deduped: number;
  inserted: number;
}

export async function rememberMany(
  texts: string[],
  embedding: EmbeddingRuntime,
  db: BetterSqlite3.Database,
  opts: RememberManyOptions = {},
): Promise<RememberManyResult> {
  if (texts.length === 0) return { total: 0, deduped: 0, inserted: 0 };
  
  // Stage 1: Batch embed (1 API call)
  const vectors = await embedding.embed(texts);
  
  // Stage 2: Intra-batch cosine dedup
  const kept = intraBatchDedup(texts, vectors, opts.dedupThreshold ?? 0.95);
  
  // Stage 3: Insert with metadata
  const now = Date.now();
  for (const item of kept) {
    insertChunkWithMetadata(db, {
      text: item.text,
      embedding: item.vector,
      created_at: now,
      importance: opts.importance ?? 0.5,
      scope: opts.scope ?? "/",
    });
  }
  
  return { total: texts.length, deduped: texts.length - kept.length, inserted: kept.length };
}
```

#### TDD
```
RED:     test_remember_many_embeds_in_single_call() — mock embed, verify called once with all texts
RED:     test_remember_many_dedup_identical_texts() — ["a","a","b"] → 2 inserted (1 deduped)
RED:     test_remember_many_dedup_near_duplicates() — cosine >= 0.95 → deduped
RED:     test_remember_many_preserves_dissimilar() — cosine < 0.95 → both kept
RED:     test_remember_many_sets_created_at() — verify timestamp on inserted chunks
RED:     test_remember_many_sets_importance() — verify importance value
RED:     test_remember_many_sets_scope() — verify scope path
RED:     test_remember_many_empty_input() — [] → {total:0, deduped:0, inserted:0}
RED:     test_remember_many_custom_dedup_threshold() — threshold 0.8 deduplicates more aggressively
RED:     test_remember_many_single_text() — 1 text → 1 inserted, no dedup
RED:     test_intra_batch_dedup_with_zero_vector() — (EC-3) zero vector → cosine returns 0, no NaN crash
GREEN:   Implement batch encoder
VERIFY:  pnpm --filter @theokit/sdk-memory exec vitest run tests/batch-encoder.test.ts
```

#### Acceptance Criteria
- [ ] Verify `embedding.embed` called exactly 1 time for N texts (not N times)
- [ ] Run test_remember_many_dedup_near_duplicates and confirm cosine ≥ 0.95 pairs are excluded from insert, returning deduped count > 0
- [ ] Verify `created_at`, `importance`, `scope` set on inserted chunks
- [ ] Run `pnpm --filter @theokit/sdk-memory exec vitest run tests/batch-encoder.test.ts` and confirm 10+ tests pass

#### DoD
- [ ] Run tests and confirm 10+ pass
- [ ] Run `pnpm --filter @theokit/sdk-memory exec tsc --noEmit` and confirm exit 0

---

## Phase 3: Composite Scoring

**Objective:** Replace inline scoring with configurable composite scorer.

### T3.1 — Composite scorer with recency decay

#### Objective
Create scoring function that blends semantic, text, recency, and importance signals.

#### Files to edit
```
packages/sdk-memory/src/internal/composite-scorer.ts (NEW) — pure scoring function
packages/sdk-memory/tests/composite-scorer.test.ts (NEW) — tests
```

#### Deep Dives

```typescript
export interface CompositeScoreConfig {
  semanticWeight: number;     // default: 0.5
  textWeight: number;         // default: 0.2
  recencyWeight: number;      // default: 0.2
  importanceWeight: number;   // default: 0.1
  recencyHalfLifeMs: number;  // default: 30 days in ms
}

export function compositeScore(
  vectorScore: number,
  textScore: number,
  createdAt: number | null,
  importance: number,
  config: CompositeScoreConfig,
): number {
  const recency = createdAt != null
    ? 0.5 ** ((Date.now() - createdAt) / config.recencyHalfLifeMs)
    : 0.5; // neutral for legacy data without timestamp
  
  return (
    config.semanticWeight * vectorScore +
    config.textWeight * textScore +
    config.recencyWeight * recency +
    config.importanceWeight * importance
  );
}
```

#### TDD
```
RED:     test_composite_score_recent_ranks_higher() — same vector/text score, newer chunk scores higher
RED:     test_composite_score_important_ranks_higher() — importance 1.0 vs 0.1
RED:     test_composite_score_exact_half_life() — at exactly half-life, recency = 0.5
RED:     test_composite_score_zero_age() — just created → recency = 1.0
RED:     test_composite_score_null_created_at() — legacy data → recency = 0.5 (neutral)
RED:     test_composite_score_backward_compat_weights() — {semantic:0.6, text:0.4, recency:0, importance:0} → same as old scoring
RED:     test_composite_score_default_config() — verify defaults
RED:     test_composite_score_normalized() — output bounded [0, 1]
GREEN:   Implement scorer
VERIFY:  pnpm --filter @theokit/sdk-memory exec vitest run tests/composite-scorer.test.ts
```

#### Acceptance Criteria
- [ ] Verify recent memories rank higher than old ones with equal vector scores
- [ ] Run test_composite_score_backward_compat_weights and confirm output matches 0.6*vectorScore + 0.4*textScore within epsilon 0.001
- [ ] Run `pnpm --filter @theokit/sdk-memory exec vitest run tests/composite-scorer.test.ts` and confirm 8+ tests pass

#### DoD
- [ ] Run tests and confirm 8+ pass
- [ ] Run `pnpm --filter @theokit/sdk-memory exec tsc --noEmit` and confirm exit 0

---

## Phase 4: Query Analysis + Hierarchical Scopes

**Objective:** Ship adaptive query analysis and scope-based isolation.

### T4.1 — Query analyzer (LLM sub-query distillation)

#### Objective
Create opt-in query analysis that decomposes complex queries into sub-queries.

#### Files to edit
```
packages/sdk-memory/src/internal/query-analyzer.ts (NEW)
packages/sdk-memory/tests/query-analyzer.test.ts (NEW)
```

#### Deep Dives

```typescript
export interface QueryAnalysisResult {
  subQueries: string[];      // 1-3 targeted sub-queries
  timeFilter?: number;       // epoch ms (e.g., "last week" → 7 days ago)
  scopeHint?: string;        // suggested scope path
}

export async function analyzeQuery(
  query: string,
  callLlm: (system: string, user: string) => Promise<string>,
): Promise<QueryAnalysisResult> {
  // Only analyze long queries (>250 chars)
  if (query.length <= 250) {
    return { subQueries: [query] };
  }
  
  const result = await callLlm(
    "Extract 1-3 targeted sub-queries from the user's question. Output JSON: {subQueries: string[], timeFilter?: string, scopeHint?: string}",
    query,
  );
  return JSON.parse(result);
}
```

#### TDD
```
RED:     test_short_query_returns_unchanged() — query < 250 chars → subQueries = [query]
RED:     test_long_query_calls_llm() — query > 250 chars → callLlm invoked
RED:     test_query_analysis_returns_sub_queries() — mock LLM returns {subQueries:["a","b"]}
RED:     test_query_analysis_with_time_filter() — mock returns timeFilter
RED:     test_query_analysis_llm_error_falls_back() — LLM throws → returns [query] as fallback
RED:     test_query_analysis_empty_query() — "" → subQueries = [""]
RED:     test_analyze_query_malformed_json_falls_back() — (EC-4) LLM returns prose → falls back to [query]
GREEN:   Implement analyzer
VERIFY:  pnpm --filter @theokit/sdk-memory exec vitest run tests/query-analyzer.test.ts
```

#### Acceptance Criteria
- [ ] Run test_short_query_returns_unchanged and confirm callLlm mock was NOT called for query "hello world"
- [ ] Run test_long_query_calls_llm and confirm result.subQueries.length is between 1 and 3
- [ ] Run test_query_analysis_llm_error_falls_back and confirm result.subQueries equals [originalQuery] when LLM throws
- [ ] Run `pnpm --filter @theokit/sdk-memory exec vitest run tests/query-analyzer.test.ts` and confirm 6+ tests pass

---

### T4.2 — Hierarchical memory scopes

#### Objective
Create scope utilities for path-based memory isolation.

#### Files to edit
```
packages/sdk-memory/src/internal/memory-scope.ts (NEW)
packages/sdk-memory/tests/memory-scope.test.ts (NEW)
```

#### Deep Dives

```typescript
export class MemoryScope {
  constructor(
    private readonly rootPath: string,
    private readonly index: IndexManager,
  ) {}

  async search(query: string, opts?: SearchOptions): Promise<MemorySearchHit[]> {
    return this.index.search(query, { ...opts, scopePrefix: this.rootPath });
  }

  child(subPath: string): MemoryScope {
    return new MemoryScope(`${this.rootPath}/${subPath}`.replace(/\/+/g, "/"), this.index);
  }

  get path(): string { return this.rootPath; }
}

export function normalizeScopePath(path: string): string {
  return ("/" + path.replace(/\/+/g, "/").replace(/^\/|\/$/g, "")).replace(/\/+/g, "/") || "/";
}
```

#### TDD
```
RED:     test_normalize_scope_path_root() — "/" → "/"
RED:     test_normalize_scope_path_simple() — "crew/agent" → "/crew/agent"
RED:     test_normalize_scope_path_trailing_slash() — "/crew/agent/" → "/crew/agent"
RED:     test_normalize_scope_path_double_slash() — "//crew///agent" → "/crew/agent"
RED:     test_memory_scope_child() — root="/crew" → child("agent") → "/crew/agent"
RED:     test_memory_scope_search_passes_prefix() — verify scopePrefix passed to index.search
RED:     test_memory_scope_nested_children() — root → child("a") → child("b") → "/a/b"
RED:     test_memory_scope_empty_string() — "" → "/"
RED:     test_memory_scope_child_with_absolute_path() — (EC-5) child("/agent") with root="/crew" → "/crew/agent"
GREEN:   Implement scope
VERIFY:  pnpm --filter @theokit/sdk-memory exec vitest run tests/memory-scope.test.ts
```

#### Acceptance Criteria
- [ ] Verify `normalizeScopePath` handles edge cases (double slashes, trailing, empty)
- [ ] Verify `MemoryScope.search()` passes `scopePrefix` to underlying index
- [ ] Verify `MemoryScope.child()` produces correct nested paths
- [ ] Run `pnpm --filter @theokit/sdk-memory exec vitest run tests/memory-scope.test.ts` and confirm 8+ tests pass

#### DoD
- [ ] Run tests and confirm 8+ pass
- [ ] Run `pnpm --filter @theokit/sdk-memory exec tsc --noEmit` and confirm exit 0

---

## Phase 5: Integration Validation (MANDATORY)

**Objective:** Validate all 4 features work together.

### Execution

```bash
pnpm --filter @theokit/sdk-memory exec vitest run    # all memory tests
pnpm --filter @theokit/sdk-memory exec tsc --noEmit   # typecheck
pnpm -w run check                                     # biome lint
```

### Acceptance Criteria

- [ ] Run `pnpm --filter @theokit/sdk-memory exec vitest run` and confirm all tests pass (287 existing + 40+ new)
- [ ] Run `pnpm --filter @theokit/sdk-memory exec tsc --noEmit` and confirm exit 0
- [ ] Run `pnpm -w run check` and confirm zero lint errors
- [ ] Verify CHANGELOG updated with 4 entries under `[Unreleased] § Added`
- [ ] Run pnpm --filter @theokit/sdk-memory exec vitest run and confirm exit 0 with 287+ tests passing

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | P1: Batch encoding pipeline | T2.1 | `rememberMany()` with batch embed + intra-batch dedup |
| 2 | P2: Composite scoring with recency decay | T3.1 | `compositeScore()` pure function with configurable weights |
| 3 | P3: Query analysis for adaptive recall | T4.1 | `analyzeQuery()` with LLM sub-query distillation (opt-in) |
| 4 | P4: Hierarchical scopes | T4.2 | `MemoryScope` class with path-based isolation |
| 5 | Schema migration for new columns | T1.1 | `created_at`, `importance`, `scope` columns added |
| 6 | 40+ new tests | T1.1-T4.2 | 5+10+8+6+8 = 37 minimum + integration |
| 7 | Backward compatibility preserved | T1.1, T3.1 | Default weights reproduce old scoring; migration preserves data |
| 8 | EC-1: Batch embed API verified | T2.1 | `EmbeddingRuntime.embed(ReadonlyArray<string>)` already supports batch |
| 9 | EC-2: Migration columns nullable | T1.1 | All columns nullable — existing rows get NULL/default |
| 10 | EC-3: Zero vector dedup guard | T2.1 | Cosine returns 0 on zero-norm vectors |
| 11 | EC-4: Malformed JSON fallback | T4.1 | Falls back to [query] on parse error |
| 12 | EC-5: Child with absolute path | T4.2 | Strips leading slash from child path |
| 13 | EC-6: Ranking order change documented | T3.1 | Legacy weights reproduce old behavior |

**Coverage: 13/13 gaps covered (100%)**

## Global Definition of Done

- [ ] Verify all phases completed
- [ ] Run `pnpm --filter @theokit/sdk-memory exec vitest run` and confirm all tests passing (327+ total)
- [ ] Run `pnpm --filter @theokit/sdk-memory exec tsc --noEmit` and confirm zero type errors
- [ ] Run `pnpm -w run check` and confirm zero lint warnings
- [ ] Verify file-size budget respected (all files ≤ 500 LoC per `architecture.md`)
- [ ] Verify CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6)
- [ ] Verify 40+ new tests added across 5 test files
- [ ] Confirm plan archived to `knowledge-base/plans/completed/` after merge
