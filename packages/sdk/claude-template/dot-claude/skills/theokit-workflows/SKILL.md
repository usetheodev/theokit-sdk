---
user-invocable: false
description: Workflow orchestration -- Workflow.create, steps, branching, retry, suspend/resume.
paths:
  - "**/*workflow*"
  - "**/*Workflow*"
  - "**/*step*"
---

# TheoKit SDK -- Workflows

Quick reference for declarative multi-step orchestration (v1.17+).

## Workflow.create / .run

```typescript
import { Agent, Workflow, fn, agentStep } from "@theokit/sdk";

const classifier = await Agent.create({ /* ... */ });
const billingExpert = await Agent.create({ /* ... */ });

type Claim = { claim: string };

// `fn` carries its OWN input/output generics — the workflow's `TInput` does not
// flow into a step's callback. Without `fn<Claim, Claim>`, `input` is `unknown`
// and `input.claim` does not compile.
const wf = Workflow.create<Claim, string>({ name: "refund-pipeline" })
  .then(fn<Claim, Claim>("validate", (input) => {
    if (!input.claim) throw new Error("missing claim");
    return input;
  }))
  .then(agentStep("classify", classifier, (i) => `Classify: ${JSON.stringify(i)}`))
  .branch([
    [(out) => String(out).includes("BILLING"), [agentStep("resolve", billingExpert, "Handle it")]],
  ], { fallback: [fn("escalate", () => "escalated")] })
  .commit();

const run = await wf.run({ claim: "I was charged twice" });
console.log(run.status, run.output);
```

## Step types

### fn step (pure function)

```typescript
import { fn } from "@theokit/sdk";

fn("validate", (input, ctx) => {
  // input: previous step's output
  // ctx: { signal, suspend(), stepId }
  return transformedInput;
}, {
  inputSchema: z.object({ /* ... */ }),   // optional Zod validation
  outputSchema: z.object({ /* ... */ }),  // optional Zod validation
  retry: {
    maxAttempts: 3,
    initialBackoffMs: 1000,
    backoffCoefficient: 2.0,
    maximumBackoffMs: 30_000,
    nonRetryableErrors: ["ConfigurationError"],
  },
});
```

### agentStep (agent.send wrapper)

```typescript
import { agentStep } from "@theokit/sdk";

agentStep("classify", agent, (input) => `Classify this: ${JSON.stringify(input)}`, {
  retry: { maxAttempts: 2, initialBackoffMs: 2000 },
});
// Third arg is a prompt renderer: (stepInput) => string
```

## Control-flow primitives

### .then (sequential)

```typescript
wf.then(fn("a", ...)).then(fn("b", ...))
```

### .parallel (fan-out)

```typescript
wf.parallel([
  [fn("branch-a", ...)],
  [fn("branch-b", ...)],
], {
  concurrency: 4,
  errorPolicy: "fail-fast",  // or "collect"
})
```

### .branch (first-match routing)

```typescript
wf.branch([
  [(output) => output.category === "billing", [agentStep("billing", billingAgent, "Handle")]],
  [(output) => output.category === "support", [agentStep("support", supportAgent, "Handle")]],
], {
  fallback: [fn("unknown", () => "escalated")],
})
```

### .foreach (map over array)

```typescript
wf.foreach("source-step-id", fn("process", (item) => transform(item)), {
  concurrency: 4,
})
```

### .dowhile (loop)

```typescript
wf.dowhile(
  fn("iterate", (input) => { /* ... */ return { done: false, data: input }; }),
  (output) => !output.done,
  { maxIterations: 100 },
)
```

### .sleep

```typescript
wf.sleep(5000, "wait-for-api")  // abortable via signal
```

### .suspend (human-in-the-loop)

```typescript
wf.then(fn("wait_approval", async (input, ctx) => {
  await ctx.suspend({ awaiting: "human-approval", draft: input });
  return "sentinel";  // never reached
}))
```

## Suspend / resume

```typescript
const first = await wf.run(undefined);
// first.status === "suspended"

// Later, after human approves:
const resumed = await Workflow.resume({
  runId: first.id,
  workflow: wf,
  payload: { approved: true, by: "manager" },
});
// resumed.status === "completed"
```

## Persistence

| Backend | When | How |
|---|---|---|
| `memory` (default) | Same-process suspend/resume | `Workflow.create({ name })` |
| `json` | Survive process restart | `Workflow.create({ name, persistence: { backend: "json", dir: ".theokit/workflows" } })` |

## Retry policy

```typescript
retry: {
  maxAttempts: 3,              // 1..20, required
  initialBackoffMs: 1000,      // default 1000
  backoffCoefficient: 2.0,     // default 2.0
  maximumBackoffMs: 30_000,    // default 30s
  nonRetryableErrors: ["ConfigurationError", "AbortError"],
}
```

Retry sleeps are abortable via `AbortSignal`. Non-retryable errors skip the retry loop.

## Cancellation

```typescript
const ctrl = new AbortController();
const promise = wf.run(input, { signal: ctrl.signal });

ctrl.abort("user cancelled");
const run = await promise;
// run.status === "cancelled"
```

`AbortSignal` is checked at step boundaries AND mid-backoff sleep. `ctx.signal` is passed to step functions so `fetch` / `agent.send` can be cancelled too.

## WorkflowRun result

```typescript
interface WorkflowRun<O> {
  id: string;
  status: "completed" | "suspended" | "cancelled" | "failed";
  output?: O;
  error?: Error;
  steps: WorkflowStepResult[];
}
```

## Telemetry

When OTel is installed, each `wf.run` emits a `workflow.run` root span and per-step `workflow.step.<id>` child spans with attributes: `workflow.name`, `workflow.run_id`, `step.kind`, `step.attempts`, `step.status`.

## Errors

| Error | Cause |
|---|---|
| `WorkflowDuplicateStepIdError` | Two steps with same id at `.commit()` |
| `WorkflowAlreadyRunningError` | Concurrent `.run()` with same `(workflowId, runId)` |
| `WorkflowSnapshotNotFoundError` | `Workflow.resume(runId)` with unknown runId |
| `WorkflowMaxIterationsExceededError` | `.dowhile` over `maxIterations` |
| `WorkflowNotSerializableError` | `ctx.suspend(payload)` with non-JSON value |
| `WorkflowResumeStepNotFoundError` | Resume against a diverged workflow definition |
| `WorkflowParallelError` | Aggregate of branch failures in fail-fast mode |
| `WorkflowCompensateNotImplementedError` | `compensate` field set (saga deferred to v1.2) |

## Limitations (v1)

- **LocalAgent only** -- cloud agent steps throw `UnsupportedRunOperationError`.
- **Saga compensation deferred** -- `compensate?` field reserved but throws if set.
- **No cron-trigger integration** -- wire via `Cron.create` calling `wf.run` directly.
