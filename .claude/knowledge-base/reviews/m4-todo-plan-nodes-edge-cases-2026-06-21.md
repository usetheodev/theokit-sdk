# Edge Case Review — m4-todo-plan-nodes

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m4-todo-plan-nodes-plan.md
Tasks analyzed: 3 (T1.1 emit items, T1.2 adapter, T2.1 barrel/wiring)
Edge cases found: 3 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 1)

## Boundary map

Two pure boundaries: the todolist result serialization (now carrying `items`) and the `todoItemsToPlanNodes` map. No I/O, no concurrency. The result is JSON-stringified, so `items` is inherently a detached snapshot. The only real edges are field-projection correctness (adapter must NOT leak `createdAt`/`completedAt`) and the error-path shape (errors must NOT gain an `items` field).

## MUST FIX

(none — additive field + pure map; backward-compat preserved by keeping `items_summary` + `getItems()`.)

## SHOULD TEST

### EC-1: the adapter projects EXACTLY `{id, label, status}` (drops timestamps)
- **Affected task:** T1.2
- **Family:** Format
- **Scenario:** a `TodoItem` carries `createdAt`/`completedAt`; `PlanNode` must contain ONLY `id`/`label`/`status` (no timestamp leak into the plan-node shape).
- **Suggested test:** `todoItemsToPlanNodes_projects_only_id_label_status` — assert `Object.keys(node)` is exactly `["id","label","status"]` (no `createdAt`).

### EC-2: error/`fail` results carry NO `items` field
- **Affected task:** T1.1
- **Family:** State
- **Scenario:** `missing_title` / `not_found` / `invalid_action` results must keep their `{ ok:false, error }` shape — adding `items` only to success paths. A consumer must not mistake an error for an empty list.
- **Suggested test:** `todolist_error_result_has_no_items` (already in the T1.1 TDD) — confirm `fail(...)` paths have no `items` key.

## DOCUMENT

### EC-3: `items` in the result is a JSON snapshot (no live reference)
- **Accepted risk:** the result is JSON-stringified, so the consumer receives a detached copy of the items at the moment of the call — never a live handle to internal state. This is inherent to the string-return tool contract; documenting it on the field is enough. No action.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 2 | 0 | EC-2 | EC-3 |
| T1.2 | 1 | 0 | EC-1 | 0 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (2 SHOULD TEST — adapter field-projection + error-no-items — fold into T1.1/T1.2 TDD, both already present; EC-3 is a docstring note; no MUST FIX)
