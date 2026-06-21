# Edge Case Review — m4-categorized-memory

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m4-categorized-memory-plan.md
Tasks analyzed: 3 (T1.1 field, T1.2 store, T2.1 barrel/wiring)
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## Boundary map

The live boundary is `createCategorizedMemory`'s `add`/`list` over the filesystem. `add` is a read-modify-write (read the category file, append a bullet, atomic-write) — the classic concurrency hazard. `list` is best-effort read (never-throw). Category validation is a closed-set membership check before any I/O. The flat `markdown-store` already solved the same RMW race with `withCwdMutex`; the plan as written (v1.0) did NOT serialize the categorized RMW.

## MUST FIX

### EC-1: concurrent `add` to the same category loses bullets (read-modify-write race)
- **Affected task:** T1.2
- **Family:** State / Timing
- **Scenario:** two `add(category, …)` calls interleave — both read the same `raw`, each appends its own bullet, the second `replaceFileAtomic` overwrites the first → one fact lost. The flat store avoids this by wrapping the RMW in `withCwdMutex(memoryDir(cwd), …)` (`markdown-store.ts:68`); the categorized store must do the same.
- **Impact:** silent data loss under concurrent writes (e.g. an agent appending facts from parallel tool calls).
- **Suggested fix:** wrap the `add` RMW in `withCwdMutex(\`catmem:${root}:${sanitizeIdentifier(category)}\`, async () => { … })` (reuse the shipped `@theokit/sdk/internal/persistence` mutex — Rule 9). Add a concurrency test: `Promise.all` of N adds to one category → `list` returns all N.

## SHOULD TEST

### EC-2: two declared categories that sanitize to the same filename collide
- **Affected task:** T1.2
- **Family:** Format
- **Scenario:** `categories: ["a b", "a-b"]` — both `sanitizeIdentifier` to `a-b` → same file; facts mix across the two "distinct" categories. The construction guard (v1.0) checks RAW uniqueness, not sanitized uniqueness.
- **Suggested test:** `categorizedMemory_rejects_categories_colliding_after_sanitize` — construction throws `ConfigurationError(invalid_categories)` when two categories share a sanitized filename. (Fix: build the `Set` of `sanitizeIdentifier(c)` and assert its size === categories.length at construction.)

### EC-3: a category whose `sanitizeIdentifier` result is empty / invalid
- **Affected task:** T1.2
- **Family:** Input
- **Scenario:** a category like `"___"` or `"..."` could sanitize to an empty or degenerate filename. `sanitizeIdentifier` throws on non-conforming input (strict grammar) — so construction should surface that as `invalid_categories`, not an unhandled throw mid-write.
- **Suggested test:** `categorizedMemory_rejects_unsanitizable_category` — a category that `sanitizeIdentifier` rejects → construction throws `ConfigurationError(invalid_categories)` (validate by attempting `sanitizeIdentifier` on each category at construction).

## DOCUMENT

### EC-4: `list()` returns full file content (no truncation / no size bound)
- **Accepted risk:** like the flat store, `list` returns every bullet in full. Categorized memory files are small markdown by convention; bounding is a caller concern. Document the no-truncation contract; adding a budget option now is YAGNI.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T1.2 | 4 | EC-1 | EC-2, EC-3 | EC-4 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN NEEDS ADJUSTMENT — EC-1 (concurrent-add RMW race) is a MUST FIX: serialize `add` with `withCwdMutex` (reuse the shipped mutex). EC-2/EC-3 (sanitized-collision + unsanitizable category) fold into the construction guard + T1.2 TDD. EC-4 is a docstring note.
