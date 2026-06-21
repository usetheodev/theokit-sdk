# Edge Case Review — m4-project-instructions

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m4-project-instructions-plan.md
Tasks analyzed: 4 (T1.1 reader, T1.2 writer, T2.1 wiring, T2.2 wiring test)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

## Boundary map

Two live boundaries: `readProjectInstructions` (fs read over `walkUpForFile`, never-throw contract) and `writeProjectInstructions` (fs write over `replaceFileAtomic`, fail-loud contract). `walkUpForFile` is already hardened (64-level cap, safe-pattern guard, realpath dedup, FS-race skip), so the residual edges are read-content shape (a path that exists but is not a readable file) and merge-degenerate cases. No network, no concurrency beyond the atomic write's own guarantees.

## MUST FIX

(none — never-throw reader reuses the hardened `walkUpForFile` + per-file readFile catch; the writer's fail-loud is ADR D4; atomic write is M0-6.)

## SHOULD TEST

### EC-1: a discovered path that exists but is a directory (e.g. a dir literally named `THEO.md`)
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** `walkUpForFile` uses `existsSync` which matches directories too. A directory named `THEO.md` would be returned by the walk; `readFile` on it throws `EISDIR`. The per-file catch must skip it (never-throw) and it must NOT appear in `files`.
- **Suggested test:** `readProjectInstructions_skips_dir_named_like_file` — create a dir `THEO.md/`, assert it is excluded and no throw.

### EC-2: `scope:"merged"` with exactly one found file (degenerate merge)
- **Affected task:** T1.1
- **Family:** Boundary
- **Scenario:** one file found, `scope:"merged"` → `content` should equal that file's content with NO trailing/leading separator (the reverse+join of a 1-element list is just the element).
- **Suggested test:** `readProjectInstructions_merged_single_file_no_separator` — one file, scope merged → `content === file.content` (no `\n\n`).

## DOCUMENT

### EC-3: `writeProjectInstructions` to a non-existent `cwd` throws (intended)
- **Accepted risk:** per ADR D4 the writer fails loud — `replaceFileAtomic` to a path whose parent dir does not exist throws, and that error propagates to the caller. This is intended (a failed write is a real error, Rule 8). Document on the function: the caller owns directory creation. No action beyond the docstring + a docs.md note.

### EC-4: reader returns FULL file content (no truncation)
- **Accepted risk:** unlike `FileContextManager` (which truncates context files to a budget), `readProjectInstructions` returns the complete content of each found file. Project-instruction files are small markdown by convention; truncation is a caller concern (the caller can pair with `@theokit/sdk/compaction`'s `estimateTokens`). Documenting the no-truncation contract is enough — adding a budget option now is YAGNI.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 4 | 0 | EC-1, EC-2 | EC-4 |
| T1.2 | 1 | 0 | 0 | EC-3 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (2 SHOULD TEST — dir-named-like-file + single-file-merge — fold into T1.1 TDD; EC-3/EC-4 are docstring/docs notes; no MUST FIX)
