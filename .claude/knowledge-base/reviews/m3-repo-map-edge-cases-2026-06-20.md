# Edge Case Review — m3-repo-map (PLAN cycle)

Date: 2026-06-20
Plan analyzed: knowledge-base/plans/m3-repo-map-plan.md
Tasks analyzed: 2 (T1.1 builders, T2.1 export/docs)
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 1)

## Boundary map

Both builders are fs readers with a never-throw contract. Live edge family: fs error handling (missing/unreadable cwd, sub-dir EACCES, symlink loop) + bounding correctness (budget cut mid-tree, depth limit, per-dir cap). No network, no mutation.

## MUST FIX

(none — never-throw is ADR D4 + T1.1 TDD; bounding is ADR D3 + tests; zero deps.)

## SHOULD TEST

### EC-1: symlink loop / cyclic directory must not infinite-loop
- **Affected task:** T1.1
- **Family:** Resource
- **Scenario:** a symlink pointing to an ancestor dir would make a naive recursive walk loop forever. The walk must bound by `maxDepth` (default 4) AND not follow directory symlinks (use `withFileTypes`/`lstat`, treat symlinks as leaf entries).
- **Suggested test:** `test_repo_map_does_not_follow_dir_symlink_loop` — temp dir with a symlink to `.` → buildRepoMap returns within budget, no hang.

### EC-2: budget cut must not split a UTF-8 line / must append the marker
- **Affected task:** T1.1
- **Family:** Boundary
- **Scenario:** stopping exactly at `budget` mid-line yields a garbled tail. Stop at a line boundary and append `… (truncated)`.
- **Suggested test:** `test_repo_map_truncation_is_line_clean` — assert output ends with the truncation marker and contains no partial final entry.

## DOCUMENT

### EC-3: empty directory / cwd with only ignored entries
- **Accepted risk:** `buildRepoMap` on an empty dir (or one containing only node_modules/.git) returns a minimal tree (the root line, no children). Safe; documented. No action.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 3 | 0 | EC-1, EC-2 | EC-3 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (2 SHOULD TEST — symlink-loop + line-clean truncation — fold into T1.1 TDD; no MUST FIX)
