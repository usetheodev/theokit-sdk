---
type: Practice
title: Observability
description: The three layers of agent observability, the telemetry defaults that keep prompts out of your traces, and which hooks block versus merely observe.
tags: [operations, telemetry, opentelemetry, hooks, monitoring]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 11.1, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 11.1 — observability in three layers
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/ (telemetry, onTool* hooks, onBeforeCreate, onBeforeSend)
    title: Telemetry and hook surface — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# Three layers

| Layer | Question | Mechanism |
| --- | --- | --- |
| **Conversation** | what did the agent say and do? | `run.stream()` / `conversation()` |
| **Operational** | rate limited? permission denied? did it compact? | `SendOptions.onRunEvent` |
| **Systemic** | latency, spans, cost, throughput | `telemetry` (OpenTelemetry) + `usage` / `cost` |

The first two are two of the three
[observation channels](/sdk/observation-channels.md); the third is the layer this page is
mostly about.

```typescript
const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  telemetry: { enabled: true, exporter: "otlp", includeContent: false },
  onToolStart: (e) => metrics.increment("tool.start", { tool: e.toolName }),
  onToolEnd: (e) => metrics.histogram("tool.duration", e.durationMs, { tool: e.toolName }),
  onToolError: (e) => log.error({ tool: e.toolName, err: e.error.message, callId: e.callId }),
  local: { cwd: process.cwd() },
});
```

# Three design decisions worth imitating

1. **`includeContent: false` by default.** Telemetry does not leak prompts or PII unless you
   ask. If you turn it on, sanitization is your responsibility — and the type says so. This is
   the exfiltration row of [attack surface](/concepts/attack-surface.md).

2. **`onTool*` hooks observe; they do not block.** An error inside one is swallowed with a
   warning on stderr, so broken instrumentation does not take down a run. Contrast with
   `onBeforeCreate` / `onBeforeSend`, which **do** block — throwing prevents the operation, and
   that is what makes them the right place for quota and anti-abuse.

   | Hook | Throwing means |
   | --- | --- |
   | `onToolStart`, `onToolEnd`, `onToolError` | warning on stderr; the run continues |
   | `onBeforeCreate`, `onBeforeSend` | the operation is prevented |

   Knowing which hook blocks and which observes is the difference between a calm deploy and an
   incident.

3. **`callId` correlates** start / end / error for the same invocation. Without a correlation
   key there is no usable trace.

# What to put on the dashboard

Runs per minute, p50/p95 latency, cost per run, error rate per tool, and doom-loop count. The
last one is the leading indicator of a tool whose error message does not tell the model what
to do differently — see [doom loop](/concepts/doom-loop.md).

Cost belongs on the same dashboard, attributed per tenant. How to measure and attribute it is
[cost management](/operations/cost-management.md), and the reason unknown cost must not appear
as zero is the same honesty rule that governs `usage` on a blocked output in
[guardrails](/sdk/guardrails.md).

# The audit trail

For a run that took a consequential action, three things belong in the record: the
`permission_denied` events, the `completion_check` outcomes, and who approved what — see
[human in the loop](/concepts/human-in-the-loop.md). In a
[closed autonomous loop](/concepts/control-cadence.md) this is not nice-to-have; it is the
only witness.

# Mastery criterion

Given an agent that is "expensive and slow", you produce an investigation plan ordered by
leverage, with the metric that would confirm each hypothesis.[^course]

[^course]: Agent AI course, Module 11.1
