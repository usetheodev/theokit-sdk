---
"@theokit/sdk": minor
---

**SE19 — `workflowAsTool` (expose a Workflow as an agent tool).**

`workflowAsTool(workflow, { name, description, inputSchema })` (from `@theokit/sdk/workflow`) turns a `Workflow` into an agent `CustomTool`, completing the Mastra "X as tools" trio (tools; agents-as-tools via `defineSubAgent`; workflows-as-tools). The handler validates the model's args against `spec.inputSchema`, runs the workflow, and returns its output (a string as-is, else JSON). A run that does not reach `status: "completed"` raises a typed `WorkflowToolError` (workflow step errors do NOT throw — they surface via `run.status === "failed"`).

Because a `Workflow` carries no top-level schema (`WorkflowOptions` is `name`/`persistence`/`workflowId`; schemas are per-step), the caller supplies the tool `inputSchema` in the spec (like `defineTool`). Accepts any `{ run }`-shaped workflow (structural), so it never imports the `Workflow` class. New exports: `workflowAsTool`, `WorkflowToolError`, `WorkflowAsToolSpec`. Additive. From the Mastra Tools comparison (SDK Evolution roadmap SE19).
