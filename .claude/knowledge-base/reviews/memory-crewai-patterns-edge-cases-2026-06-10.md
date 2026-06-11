# Edge Case Review — memory-crewai-patterns

Date: 2026-06-10
Tasks analyzed: 5 (T1.1, T2.1, T3.1, T4.1, T4.2)
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: EmbeddingRuntime.embed() may not accept string[] — batch call will crash
- **Affected task:** T2.1
- **Family:** Integration / Boundary
- **Scenario:** The plan assumes `embedding.embed(texts)` accepts `string[]` and returns `number[][]`. The current `EmbeddingRuntime` interface may only accept `ReadonlyArray<string>` with single-text optimization internally. If `embed()` doesn't batch natively and instead loops internally, the "10x cost reduction" claim is false.
- **Impact:** Either runtime crash (if API rejects array) or false efficiency claim (if it loops internally).
- **Suggested fix:** Verify `EmbeddingRuntime.embed` signature before implementation. If it already accepts `ReadonlyArray<string>`, document that batch is native. If not, add the overload in sdk-memory.

### EC-2: ALTER TABLE ADD COLUMN with NOT NULL default on existing rows
- **Affected task:** T1.1
- **Family:** State / Resource
- **Scenario:** SQLite's ALTER TABLE ADD COLUMN with a DEFAULT clause works for new rows, but existing rows get the default value. However, `created_at INTEGER` with no DEFAULT means existing chunks get `NULL`. The composite scorer handles this (`createdAt != null ? ... : 0.5`), but if the column is defined as `NOT NULL` it will fail migration on existing data.
- **Impact:** Migration crash on existing databases with data.
- **Suggested fix:** Define columns as nullable: `ALTER TABLE chunks ADD COLUMN created_at INTEGER` (no NOT NULL, no DEFAULT). The scorer already handles NULL with neutral score 0.5.

## SHOULD TEST

### EC-3: Cosine similarity dedup with zero vectors
- **Affected task:** T2.1
- **Suggested test:** `test_intra_batch_dedup_with_zero_vector()` — if embedding API returns all-zero vector (e.g., empty text, API error), cosine similarity is NaN (0/0 division). Guard with: `if (norm === 0) return 0;`

### EC-4: Query analyzer JSON parse failure
- **Affected task:** T4.1
- **Suggested test:** `test_analyze_query_malformed_json_falls_back()` — if LLM returns non-JSON (hallucinated prose), `JSON.parse()` throws. The plan mentions fallback to `[query]` on error, but the test should verify this explicitly with a mock returning `"Here are some sub-queries: ..."` instead of valid JSON.

### EC-5: MemoryScope.child() with absolute path
- **Affected task:** T4.2
- **Suggested test:** `test_memory_scope_child_with_absolute_path()` — `root="/crew"` → `child("/agent")` should produce `/crew/agent` (strip leading slash from child), NOT `//agent`. The `normalizeScopePath` handles this but test it explicitly.

## DOCUMENT

### EC-6: Composite scoring changes ranking order for existing users
- **Accepted risk:** Users with existing memory databases who upgrade will see different search result ordering (recency + importance now factor in). This is a behavioral change, not a bug. Acceptable because: (a) old behavior reproducible with legacy weights `{recencyWeight: 0, importanceWeight: 0}`, (b) the upgrade is opt-in (users must update sdk-memory), (c) improved ranking is the whole point.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 (EC-2) | 0 | 0 |
| T2.1 | 2 | 1 (EC-1) | 1 (EC-3) | 0 |
| T3.1 | 1 | 0 | 0 | 1 (EC-6) |
| T4.1 | 1 | 0 | 1 (EC-4) | 0 |
| T4.2 | 1 | 0 | 1 (EC-5) | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — 2 MUST FIX:
1. EC-1: Verify `EmbeddingRuntime.embed()` batch signature before implementing
2. EC-2: Define migration columns as nullable (no NOT NULL)
