---
type: Reference
title: Run signals
description: Every terminal and out-of-band signal a run reports — on RunResult and on RunEvent — with what each means and where it is handled.
tags: [reference, runtime, signals, observability]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Appendix B, absorbed into this bundle 2026-08-06
    title: Agent AI course, Appendix B — signal and terminal catalog
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/run.ts
    title: RunResult and RunEvent — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# Signal catalog

| Signal | Where | Means |
| --- | --- | --- |
| `status: "finished"` | `RunResult` | the only success condition |
| `status: "cancelled"` | `RunResult` | cancelled or tripwire — **not an error** |
| `status: "error"` | `RunResult` | see `error` for the cause |
| `stoppedAtIterationLimit` | `RunResult` | **truncated**; the model wanted to continue |
| `stoppedByDoomLoop` | `RunResult` | no progress; investigate the tool |
| `tripwire` | `RunResult` | a guardrail blocked (policy, not a bug) |
| `usage` / `cost` | `RunResult` | `undefined` when unknown, never `0` |
| `completionCheck.parseFailed` | `RunResult` | unreadable judge ⇒ does not approve (fail-safe) |
| `permission_denied` | `RunEvent` | policy denied a tool |
| `rate_limit` | `RunEvent` | the provider throttled; watch the pattern |
| `tripwire` | `RunEvent` | out-of-band view of the guardrail block |
| `tool_progress` | `RunEvent` | long-running tool reporting progress |
| `task_started` / `task_updated` / `task_completed` | `RunEvent` | observable task lifecycle |
| `completion_check` | `RunEvent` | a judge evaluated whether the send is complete |
| `compact_boundary` | `RunEvent` | history was compacted |
| `compaction_fallback` | `RunEvent` | compaction degraded to plan B |

# How to read the two channels

`RunResult` answers **how did it end**. Its seven possibilities and the action each demands
are [loop terminals](/concepts/loop-terminals.md).

`RunEvent` answers **what happened along the way that operations should know about**. It is
deliberately not the content channel — see
[observation channels](/sdk/observation-channels.md) for why mixing them is a design error.

# The three that are routinely mishandled

* **`cancelled`** — a user aborted, or a guardrail fired. Alerting on it produces alert
  fatigue and trains the on-call to ignore real alerts.
* **`stoppedAtIterationLimit`** — the run *looks* successful and is truncated. Unread, this is
  the costliest agent bug.
* **`cost` undefined** — unknown, not zero. Collapsing the two corrupts financial reporting;
  see [cost management](/operations/cost-management.md).

# The error side

When `status === "error"`, the cause is an `AgentRunError` whose `code` is one of sixteen
values, with a per-provider mapping — that whole table is
[error codes](/reference/error-codes.md), and turning a code into a response policy is
[failure taxonomy](/sdk/failure-taxonomy.md).[^course]

[^course]: Agent AI course, Appendix B
