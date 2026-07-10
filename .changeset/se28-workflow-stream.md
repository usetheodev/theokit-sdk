---
"@theokit/sdk": minor
---

**SE28 — `Workflow.stream()` (step-event stream during execution).**

`workflow.stream(input, opts?)` (from `@theokit/sdk/workflow`) runs the workflow and emits step-level events as they happen, instead of only the terminal result. It returns a `WorkflowStream` — an async iterator of `WorkflowEvent`s (`step_started` / `step_completed` (with `output`) / `step_failed` (with `error`) / `workflow_suspended` / `workflow_completed`) plus a `result` promise resolving to the SAME terminal `WorkflowRun` `run()` returns (the authoritative outcome — the stream ends when the run terminates).

Events fire in execution order for top-level steps (nested `parallel`/`branch`/`foreach` emit as their single wrapping step — coarse-grained by design). This is a STEP-event stream, distinct from the token-delta agent stream deferred in SE24. `run()` is unchanged + authoritative. New public types `WorkflowEvent` + `WorkflowStream`. Mirrors Mastra's `run.stream()` / `stream.result`. From the Mastra Workflows comparison (SDK Evolution roadmap SE28).
