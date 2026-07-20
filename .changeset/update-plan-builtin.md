---
"@theokit/sdk-tools": minor
---

Add `createUpdatePlanTool` — a Codex-faithful `update_plan` built-in. The model posts a DECLARATIVE plan
(an ordered list of steps, each `pending | in_progress | completed`) and refreshes it as work proceeds.
Surface-agnostic by design: returns STRUCTURED `{ ok, explanation, steps, warning? }` so each surface
renders the checklist itself (no hard-coded glyphs). Follows Codex's "exactly one step in_progress"
invariant as a non-fatal `warning` (never rejects), so the agent self-corrects on the next update.
Distinct from the imperative `createTodolistTool` (add/complete by id) and `createPlanModeTool` (mode
toggle) — this is the declarative full-plan post.
