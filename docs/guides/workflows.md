# Workflows

A `Workflow` is a typed, resumable pipeline of steps — pure functions, agent calls, and control flow (parallel, branch, foreach, loop, sleep, suspend) — built with a fluent `.then(...)` chain. Import from `@theokit/sdk/workflow` (also re-exported from the main barrel). Full reference: [`docs.md` § Workflows](../../docs.md).

## The shape

```typescript
import { Workflow, fn, agentStep } from "@theokit/sdk/workflow";
import { z } from "zod";

const wf = Workflow.create<{ claim: string }, string>({ name: "refund-pipeline" })
  .then(fn("validate", (input) => ({ ok: input.claim.length > 0 })))
  .then(agentStep("classify", classifier, (i) => `Classify: ${JSON.stringify(i)}`))
  .then(fn("decide", (c) => (c.ok ? "approved" : "denied")));

const run = await wf.run({ claim: "double charge" });   // run.status, run.output
```

## Control-flow primitives

| Primitive | Purpose |
|---|---|
| `.then(step)` | Sequential step |
| `.parallel([a, b], { concurrency })` | Fan-out concurrent branches (`errorPolicy: "fail-fast" \| "collect"`) |
| `.branch([[pred, [...]], …], { fallback })` | First-match-wins routing |
| `.foreach(srcStepId, step, { concurrency })` | Map over an upstream array (default concurrency 4) |
| `.dowhile(step, cond, { maxIterations })` | Loop until `cond` is false (default cap 100) |
| `.sleep(ms, id?)` | Abortable pause |
| `.suspend({ payloadSchema })` | Pause until `Workflow.resume(...)` — human-in-the-loop |

## Step types

- `fn("id", (input, ctx) => …, { inputSchema?, outputSchema?, retry? })` — a pure function step with optional per-step Zod schemas + retry/backoff.
- `agentStep("id", agent, (input) => prompt, { retry? })` — runs `agent.send(prompt)` and returns its result.

## Live progress — `.stream()` (SE28)

`workflow.stream(input)` yields step events LIVE as the run executes, and its `.result` resolves to the terminal run:

```typescript
const stream = wf.stream({ claim });
for await (const ev of stream) {
  // ev.type: workflow_started | step_started | step_completed | step_failed | workflow_suspended | workflow_completed
  if (ev.type === "step_completed") ui.markDone(ev.stepId);
}
const run = await stream.result;   // authoritative terminal WorkflowRun
```

## Shared state — `stateSchema` + `ctx.state` (SE29)

Workflow-scoped mutable state, validated and durable across suspend/resume:

```typescript
const wf = Workflow.create({ name: "counter", stateSchema: z.object({ n: z.number() }), initialState: { n: 0 } })
  .then(fn("inc", (_i, ctx) => { ctx.setState({ n: ctx.state.n + 1 }); }))
  .then(fn("read", (_i, ctx) => ctx.state.n));   // sees the mutation from the previous step
```

`ctx.setState` validates against `stateSchema` and throws a typed `WorkflowStateError` on mismatch.

## Whole-workflow I/O validation (SE27)

`Workflow.create({ name, inputSchema, outputSchema })` validates the input **before step 1** (fail-fast, typed `WorkflowInputError`) and the final output on the `completed` path (typed `WorkflowOutputError`, `status: "failed"`, never throws out of `run()`).

## Compose workflows

- **Workflows as steps (SE30):** `.then(workflowStep(childWorkflow))` runs a child workflow as a step; `cloneWorkflow(wf, { id })` makes an independent copy with its own id.
- **Workflow as an agent tool (SE19):** `workflowAsTool(wf, { name, description, inputSchema })` exposes a workflow to an agent as a `CustomTool`.
- **Schedule a workflow (SE35):** `Cron.create({ cron, workflow, inputData })` runs `workflow.run(inputData)` on each fire — see [Cron jobs](./cron-jobs.md).

## Suspend & resume

`.suspend({ payloadSchema })` pauses the run and persists a snapshot; `Workflow.resume(runId, payload)` continues it. Backends: in-memory (same process) or a durable store — see [`docs.md` § Suspend/resume](../../docs.md).

## Errors

Every failure is typed: `WorkflowInputError`, `WorkflowOutputError`, `WorkflowStateError`, `WorkflowNestedError`, `WorkflowToolError`, plus the snapshot/compensate errors. Catch the specific class you care about.

## Next

- [Cron jobs](./cron-jobs.md) — schedule a workflow on a cron expression
- [Subagents](./subagents.md) — delegation the workflow's `agentStep` can drive
- [`docs.md` § Workflows](../../docs.md) — the full contract (every primitive + option)
