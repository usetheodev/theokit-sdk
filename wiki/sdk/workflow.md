---
type: API Guide
title: Workflow
description: Deterministic steps that may call an LLM — the builder surface, the suspend/resume durability point, and workflowAsTool.
tags: [api, workflow, orchestration, durability]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 6.2 and 6.3, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 6.2 — Workflow
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: workflow-src
    resource: packages/sdk/src/workflow.ts
    title: Workflow builder — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# The shape

```typescript
import { Agent } from "@theokit/sdk";
import { Workflow, agentStep, fn } from "@theokit/sdk/workflow";

const writer = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: "You write exactly one concise, factual sentence. No preamble.",
});

const pipeline = Workflow.create({ name: "topic-fact" })
  .then(fn("normalize", (input: { topic: string }) => input.topic.trim().toLowerCase()))
  .then(agentStep("write", writer, (topic) => `Write a one-sentence fact about ${String(topic)}.`))
  .commit();

const run = await pipeline.run({ topic: "  The Moon  " });
console.log(run.status, run.output); // "completed"
```

A workflow is rung 2 of the [determinism ladder](/concepts/determinism-ladder.md): you own
the order, the model owns the content.

# Builder surface

| Method | Semantics |
| --- | --- |
| `.then(step)` | sequence |
| `.parallel([...])` | concurrent fan-out |
| `.branch([...])` | conditional choice |
| `.foreach(iterableFrom, step)` | map over a collection |
| `.dowhile(step, cond)` | repeat with a condition |
| `.sleep(ms)` | wait |
| `.suspend({ payloadSchema })` | **durable pause** → resumed with `Workflow.resume` |
| `.commit()` | freeze and return the `Workflow` |

Extras: `Workflow.create(...).stream(input)` for step events; `workflowStep` to nest
workflows; `cloneWorkflow`; and `workflowAsTool` to **expose a workflow as an agent tool** — a
powerful combination, because the agent decides *whether* to call it while the workflow
guarantees *how* it executes. That is the right home for a refund policy: not in the prompt,
where it is a suggestion, but in a committed workflow, where it is a guarantee.

A committed workflow also describes its own shape: `myWorkflow.describe()` returns
`{ name, steps }` with `steps: [{ id, kind, steps? }]`. There is no registry on purpose — the
host holds the workflows it defined, so it maps over its own.

# The durability point

This is the whole reason `Workflow` exists alongside agents:

> **Durable execution exists only here, and only at `suspend()` boundaries.**

```typescript
// process 1
const run = await refundFlow.run({ orderId: "ORD-991", amount: 1200 });
console.log(run.status); // "suspended"

// hours later, ANOTHER process
const resumed = await Workflow.resume({
  runId: request.runId,
  workflow: refundFlow,
  payload: { approved: true, by: "manager@company.com" },
});
```

`ctx.suspend()` returns `Promise<never>`: nothing after it in the step executes. The `runId`
is the entire contract with whatever is outside — an identifier that survives a restart, not
a live object.

Two honest limits, both registered:

* The suspended payload is `unknown`. There is no **typed** approval state maintained by the
  SDK; you model that in your own table (gap G4).
* Nothing else in the SDK is durable in this sense. The agent loop resumes a *conversation*,
  not an execution. See [durability boundary](/concepts/durability-boundary.md).

The applied HITL pattern built on this is
[human in the loop](/concepts/human-in-the-loop.md) § Seam B.

# When to reach for it

| Requirement | Workflow? |
| --- | --- |
| Known steps, LLM-generated content | yes — determinism plus testability |
| Must survive a restart or a deploy | yes, with `suspend()` — nothing else here does |
| Long scheduled work | yes — see [concurrency and scheduling](/operations/concurrency-and-scheduling.md) |
| A deterministic policy an agent may invoke | yes, via `workflowAsTool` |
| Genuinely unpredictable order | no — that is the agent case |

A useful downgrade exercise: take an agent that performs three fixed steps and rewrite it as
a workflow, then compare tokens, latency and variance across five runs. The gap is usually
larger than expected.[^course]

[^course]: Agent AI course, Module 6.2
[^workflow-src]: `packages/sdk/src/workflow.ts`
