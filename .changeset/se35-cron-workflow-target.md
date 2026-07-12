---
"@theokit/sdk": minor
---

**SE35 — schedule a workflow on the `Cron` primitive (`workflow` + `inputData`).**

A `Cron` job may now target a committed `Workflow` (SE27–30) instead of an agent — the runtime-legitimate slice of a peer framework's Schedules. `Cron.create({ cron, workflow, inputData })` runs `workflow.run(inputData)` on each fire, reusing the shipped in-process scheduler + Task-registry observability. Mutually exclusive with agent targets: exactly one of `agent` | `agentId` | `workflow`; `message` is required for agent targets and forbidden with a workflow (typed `ConfigurationError`s: `cron_ambiguous_target` / `cron_no_target` / `cron_workflow_message` / `cron_missing_message`). `Cron.run(jobId)` returns `Run | WorkflowRun`; the fire handler records the correct terminal status for either shape.

Per ADR 0014, the job holds the `Workflow` **instance** (not a `workflowId` + resolver registry) — the cron store is in-memory, so there is no serialization problem to solve and a registry would be YAGNI; workflow cron jobs are local-runtime only (an instance can't cross the cloud boundary). Fire lifecycle hooks (`prepare`/`onFinish`/`onError`/`onAbort`) are deferred with a named re-eval trigger. Back-compat: agent-target jobs are byte-identical. From the a peer framework Schedules comparison (SDK Evolution roadmap SE35).
