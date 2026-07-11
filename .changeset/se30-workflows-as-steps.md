---
"@theokit/sdk": minor
---

**SE30 — workflows-as-steps (`workflowStep`) + `cloneWorkflow`.**

`workflowStep(child, { id? })` (from `@theokit/sdk/workflow`) uses a committed `Workflow` as a step inside another workflow: `.then(workflowStep(child))`. The child runs in its OWN executor (own runId, single-flight lock, and step-id space — so nested ids never collide with the parent's); its output becomes the step output. `cloneWorkflow(wf, { id })` returns a new independent `Workflow` with the same committed steps under a new name + a fresh workflowId (clones run independently, distinct observability identity).

A non-`completed` child fails the parent step with a typed `WorkflowNestedError`. **Nested suspend/resume is NOT supported in v1** (TheoKit's resume continues AFTER the suspended step, so a nested child would be skipped) — a nested `suspended` fails with a clear message pointing at a top-level suspend; re-running the child on resume (which would re-execute its side effects) is deliberately avoided. ADR 0010. New export `WorkflowNestedError`. Mirrors Mastra's workflows-as-steps + `cloneWorkflow`. From the Mastra Workflows comparison (SDK Evolution roadmap SE30).
