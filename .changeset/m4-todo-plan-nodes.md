---
"@theokit/sdk-tools": minor
---

M4-5 — `todolist` structured items (latent bug fix) + `todoItemsToPlanNodes` adapter (plan `m4-todo-plan-nodes`).

- **Fix:** the `todolist` tool returned only a formatted `items_summary` STRING — never the structured `items` array — so a consumer parsing the result to render a plan/UI always recovered `[]`. Every list-bearing result now ALSO carries `items: TodoItem[]` (a snapshot copy), alongside the preserved `items_summary`. `getItems()` + error/`fail` shapes are unchanged.
- **Add:** `todoItemsToPlanNodes(items: readonly TodoItem[]): PlanNode[]` — a versioned, pure adapter mapping each item to `{ id, label: title, status }` (timestamps dropped, order preserved) + the `PlanNode` type. Replaces consumer-side hand-rolled mappers.

Zero new dependencies.
