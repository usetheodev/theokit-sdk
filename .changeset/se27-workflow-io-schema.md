---
"@theokit/sdk": minor
---

**SE27 — workflow-level `inputSchema` / `outputSchema` (validate the whole-workflow I/O).**

`Workflow.create({ ..., inputSchema, outputSchema })` (from `@theokit/sdk/workflow`) now validates the workflow's overall input and final output, closing the SE19 debt (a Workflow carried no top-level schema — only per-step `FnStep` schemas). When `inputSchema` is set, `run(input)` validates `input` BEFORE step 1; a mismatch fails fast with `status: "failed"` and a typed `WorkflowInputError` in `run.error` (no step executes, no silent coerce). When `outputSchema` is set, the terminal `completed` output is validated before `WorkflowRun.output` is populated; a mismatch yields `status: "failed"` with a typed `WorkflowOutputError` (only the `completed` path is checked — suspended/failed runs skip output validation).

Both surface as `status: "failed"` (never a throw — consistent with the executor's non-throwing step-error contract). Back-compat: absent schemas ⇒ unchanged. New exports `WorkflowInputError` / `WorkflowOutputError`. `workflowAsTool` (SE19) keeps taking its own `inputSchema` to preserve its structural `{ run }` contract. Mirrors Mastra's `createWorkflow({ inputSchema, outputSchema })`. From the Mastra Workflows comparison (SDK Evolution roadmap SE27).
