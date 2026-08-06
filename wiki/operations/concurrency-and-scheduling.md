---
type: Practice
title: Concurrency and scheduling
description: Bounded pools instead of unlimited fan-out, the append-only resumable batch pattern, and scheduled or background work via Cron and observable Tasks.
tags: [operations, concurrency, batch, cron, resilience, persistence]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 11.3 and 11.4, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 11 — concurrency, scheduled and background work
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/concurrency, /persistence, /cron (public sub-entries)
    title: Concurrency, persistence and cron surface — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# Bounded concurrency

```typescript
import { mapWithConcurrency, Semaphore } from "@theokit/sdk/concurrency";

const results = await mapWithConcurrency(tickets, 8, async (t) => processTicket(t));
```

Unlimited concurrency with agents is a rate-limit machine: you pay backoff latency *and* lose
aggregate throughput. **Always a bounded pool.** Start low (4–8) and raise it with
measurement.

`mapWithConcurrency(items, concurrency, fn)` returns ordered results from a bounded pool;
`Semaphore.create(n)` is the raw gate if you need it elsewhere.

# The resumable batch

The pattern that saves long jobs:

```typescript
import { appendJsonl, readJsonlIds } from "@theokit/sdk/persistence";

const done = readJsonlIds("out/preds.jsonl", (r) => String(r.id));
const pending = items.filter((i) => !done.has(i.id));

await mapWithConcurrency(pending, 8, async (item) => {
  const out = await processItem(item);
  appendJsonl("out/preds.jsonl", { id: item.id, out }); // per-line flush
});
```

Why it works: append-only writes with a per-line flush, and a reader that **tolerates a
trailing partial line** (a crash mid-write). Resuming is a `filter`.

It is simple, and that is exactly why it is reliable — compare with a job that keeps progress
in memory and loses 40 minutes to a deploy. The proof is the test: kill the process at ~40%,
restart, and assert zero reprocessing.

Note the relationship to [durability boundary](/concepts/durability-boundary.md): this is
durability you built out of two primitives, not durability the agent loop gave you. For work
that must resume *mid-step* rather than mid-list, the answer is a
[workflow](/sdk/workflow.md) with `suspend()`.

# Scheduled work

```typescript
import { Cron } from "@theokit/sdk/cron";

const job = await Cron.create({ /* schedule + agent or workflow + input */ });
await Cron.start();
const status = await Cron.status();
```

Surface: `create`, `list`, `get`, `delete`, `enable`, `disable`, `run` (fire now), `start`,
`stop`, `status`.

It accepts a **workflow**, not only an agent — and by the reasoning in
[durability boundary](/concepts/durability-boundary.md), long scheduled work is precisely
where a workflow with `suspend()` beats an agent loop. A cron-triggered agent is also a
[closed autonomous loop](/concepts/control-cadence.md) by definition, so its three
preconditions apply: a measurable completion criterion, a hard budget ceiling, and
fail-closed permissions.

# Observable tasks

```typescript
const run = await agent.send("Long job", { task: { id: "job-42", meta: { userId } } });
// registers the run as an observable Task: list, inspect, cancel, subscribe
```

Task lifecycle events arrive on the `RunEvent` channel as `task_started`, `task_updated` and
`task_completed` — see [run signals](/sdk/run-signals.md). Durable task persistence is
`InMemoryTaskStore` / `JsonFileTaskStore` / `getTaskStoreFor` from `@theokit/sdk/task-store`.

# The runbook question

Background work is where the operational questions get real: how do you cancel a stuck run,
and how do you investigate an anomalous cost? Both belong in a written runbook — see
[production readiness](/operations/production-readiness-checklist.md) and
[governance](/operations/governance.md).[^course]

[^course]: Agent AI course, Module 11
