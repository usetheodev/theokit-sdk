---
type: API Guide
title: Observation channels
description: Why messages, deltas and events are three separate channels, the full type union of each, and the architectural lesson about mixing observability into the content channel.
tags: [api, streaming, observability, architecture]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 4.4, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 4.4 — three levels of observation
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/
    title: SDKMessage, InteractionUpdate and RunEvent unions — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# Three channels, three purposes

| Level | How you subscribe | Granularity | Correct use |
| --- | --- | --- | --- |
| **`SDKMessage`** via `run.stream()` | `for await` | whole message | application logic, message UI |
| **`InteractionUpdate`** via `SendOptions.onDelta` | callback | token / delta | real-time typing UI |
| **`RunEvent`** via `SendOptions.onRunEvent` | callback | out-of-band event | **observability** |

# The unions

```typescript
// SDKMessage.type
"system" | "user" | "assistant" | "thinking" | "tool_call" | "status" | "task" | "request" | "object_delta"

// InteractionUpdate.type  (deltas)
"text-delta" | "thinking-delta" | "thinking-completed" | "tool-call-started" | "partial-tool-call"
| "tool-call-completed" | "token-delta" | "step-started" | "step-completed" | "turn-ended"
| "user-message-appended" | "summary" | "summary-started" | "summary-completed" | "shell-output-delta"

// RunEvent.type  (observability)
"tripwire" | "tool_progress" | "rate_limit" | "permission_denied"
| "task_started" | "task_updated" | "task_completed" | "completion_check"
| "compact_boundary" | "compaction_fallback"
```

# The architectural lesson

Mixing observability into the content channel is a design error that gets paid for in
production. `rate_limit` and `permission_denied` **are not conversation messages** — if you
push them down the same channel, the UI consumer has to filter events that do not concern it,
and the operations dashboard has to reprocess messages.

> **Separate channels by *purpose*, not by convenience.**

This is the same principle as the model-facing / app-facing split in
[tools and ACI](/sdk/tools-and-aci.md): one execution, two destinations with different
requirements, and a design that fuses them forces a false trade-off.

# Which channel answers which question

| Question | Channel |
| --- | --- |
| What did the agent say and do? | `SDKMessage` via `run.stream()` / `conversation()` |
| Show me tokens as they arrive | `InteractionUpdate` via `onDelta` |
| Did we get rate-limited? Was a permission denied? Did it compact? | `RunEvent` via `onRunEvent` |
| Latency, spans, cost, throughput | `telemetry` (OpenTelemetry) + `usage` / `cost` |

The last row is the fourth, systemic layer — see [observability](/operations/observability.md)
for the whole picture, including which hooks block and which merely observe.

```typescript
const run = await agent.send("Handle the refund request", {
  onDelta: (u) => { if (u.type === "text-delta") ui.append(u.text); },
  onRunEvent: (ev) => {
    if (ev.type === "permission_denied") audit.record(ev);
    if (ev.type === "rate_limit") metrics.increment("provider.rate_limited");
    if (ev.type === "compact_boundary") metrics.increment("context.compacted");
  },
});
```

Every event above has a matching entry in [run signals](/sdk/run-signals.md), which is the
full catalog of terminal and out-of-band signals.

# The bug the wrong channel produces

A concrete example worth remembering: routing `permission_denied` through the message stream
makes the chat UI render "permission denied" as if the agent said it. The user sees an
apology; the operator sees nothing. Both halves are wrong, and both come from one channel
choice.[^course]

[^course]: Agent AI course, Module 4.4
