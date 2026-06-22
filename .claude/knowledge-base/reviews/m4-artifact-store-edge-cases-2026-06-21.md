# Edge Case Review — m4-artifact-store

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m4-artifact-store-plan.md
Tasks analyzed: 2 (T1.1 store, T2.1 plan-mode composition + barrel)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

## Boundary map

Two boundaries: the artifact store (`write` fail-loud, `read`/`has`/`list` never-throw, traversal neutralized by `safeFilenameForId` + `safePathJoin`) and the plan-mode async handler (persists `plan` on `exit` when a store is configured). `write` is a full overwrite via atomic rename (no read-modify-write → no concurrency race, unlike the categorized memory). The plan already folds the high-risk store edges (traversal, read-missing, overwrite) into T1.1 TDD.

## MUST FIX

(none — `write` is atomic overwrite [no RMW race]; traversal neutralized by `safeFilenameForId`+`safePathJoin`; read never-throws; the plan-mode zero-arg sync path is preserved by overload.)

## SHOULD TEST

### EC-1: plan-mode `exit` with an empty/absent `plan` must NOT persist
- **Affected task:** T2.1
- **Family:** Input
- **Scenario:** the agent calls `exit` without a `plan` (or `plan: ""`). The handler must skip the write (no empty artifact) and still toggle to normal mode, returning `persisted: false` (or omitting it).
- **Suggested test:** `planMode_store_exit_without_plan_does_not_persist` — `exit` with no `plan` → mode normal, no file written (`has` false), `persisted` not true.

### EC-2: plan-mode `enter` with a store must not persist (only `exit` does)
- **Affected task:** T2.1
- **Family:** State
- **Scenario:** entering plan mode should never write an artifact (there is no plan yet). Only `exit` (with a `plan`) persists.
- **Suggested test:** `planMode_store_enter_does_not_persist` — `enter` then assert the store has no artifact.

## DOCUMENT

### EC-3: `list()` returns on-disk filename stems, not original ids (when the id strategy hashes)
- **Accepted risk:** `safeFilenameForId` hashes non-conforming ids to `h-<hex>`, so `list()` returns storage keys, not the original ids. `read(id)`/`has(id)` round-trip (they apply the same strategy). Documented on `list()` + in Drawbacks. No action.

### EC-4: a fixed `artifactId` overwrites on each plan-mode `exit`
- **Accepted risk:** with the default/fixed `artifactId` (`"plan"`), successive `exit`s overwrite the same artifact (atomic last-writer-wins). A consumer wanting per-run history passes a unique `artifactId` (e.g. the run id). Documented on the overload. No action — overwrite is the sane default for "the current plan".

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 0 | 0 | 0 | 0 |
| T2.1 | 4 | 0 | EC-1, EC-2 | EC-3, EC-4 |

**Verdict:** PLAN OK (2 SHOULD TEST — empty-plan-no-persist + enter-no-persist — fold into T2.1 TDD; EC-3/EC-4 are docstring notes; no MUST FIX)
