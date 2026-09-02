---
"@theokit/sdk": patch
---

Workflow errors now carry `code` and `isRetryable`, so the SDK's own retry helper can see them.

Eleven public workflow error classes extended plain `Error`. `isTransientError` is
`err instanceof TheokitAgentError && err.isRetryable === true`, and it is the default predicate of
`Retry.create` — so a class outside the hierarchy is permanent *by contract*, whatever it actually
represents. Wrapping `workflow.run()` in the SDK's own retry helper therefore got `false` for every
workflow failure, including `WorkflowAlreadyRunningError`, which is precisely the
try-again-in-a-moment condition.

They now extend `TheokitAgentError`, each with a stable `code`:

| code | retryable |
|---|---|
| `workflow_already_running` | **yes** — another run holds the single-flight lock |
| `workflow_duplicate_step_id`, `workflow_input_invalid`, `workflow_output_invalid`, `workflow_state_invalid`, `workflow_nested_failed`, `workflow_snapshot_not_found`, `workflow_max_iterations_exceeded`, `workflow_not_serializable`, `workflow_resume_step_not_found`, `workflow_compensate_not_implemented` | no |

Source-compatible: `TheokitAgentError extends Error`, so `instanceof Error` and `err.name` are
unchanged, and every existing field (`stepId`, `workflowName`, `detail`, …) stays where it was.

`WorkflowParallelError` is deliberately unchanged — it extends `AggregateError`, and the standard
`errors` array is why callers catch it. It stays outside the hierarchy, and therefore stays
non-retryable; inspect `err.errors` and decide per branch.
