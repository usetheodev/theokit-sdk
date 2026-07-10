---
"@theokit/sdk": minor
---

**SE29 — workflow shared state (`stateSchema` + `state` / `setState`).**

Workflow steps can now share values without threading them through every step's input/output. `Workflow.create({ stateSchema, initialState })` (from `@theokit/sdk/workflow`) seeds a shared state; every step's `StepContext` gains `state` (read the current value) and `setState(next)` (update it for subsequent steps). `setState` validates against `stateSchema` when set — a mismatch throws a typed `WorkflowStateError` that fails the step/run (Rule 8); an invalid `initialState` fails the run fast before step 1.

State is captured in the `WorkflowSnapshot` (bumped to `_schemaVersion: 2`) and restored on `Workflow.resume` — it survives a suspend→resume round-trip. A pre-SE29 (`_schemaVersion: 1`) snapshot has no state and resumes with `initialState`. Back-compat: no `stateSchema`/`initialState` ⇒ `state` is `undefined` and `setState` is unvalidated. New export `WorkflowStateError`. Mirrors Mastra's workflow `state`/`setState`/`stateSchema`. From the Mastra Workflows comparison (SDK Evolution roadmap SE29).
