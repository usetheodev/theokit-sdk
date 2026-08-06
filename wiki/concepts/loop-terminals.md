---
type: Reference
title: Loop terminals
description: The seven ways an agent run can end, what each means, and the different action each demands from the caller.
tags: [fundamentals, runtime, error-handling, reliability]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 2.2, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 2.2 — the seven ways to end
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/run.ts
    title: RunResult type — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# The seven terminals

A junior engineer knows two (`success`, `error`). A Staff engineer knows seven, because each
demands different handling from the caller.

| Terminal | Meaning | What the caller must do |
| --- | --- | --- |
| **done** | the model emitted a final answer | consume the result |
| **iteration ceiling** | the model still wanted to act; the loop cut it off | **re-send a continuation** or report truncation |
| **doom loop** | identical repeated tool calls — zero progress | stop; this is a tool or prompt bug, not a shortage of iterations |
| **budget** | token or cost ceiling reached | decide whether to extend or abort |
| **cancellation** | someone called `cancel()` / aborted | not an error; do not alert |
| **tripwire** | a guardrail blocked input or output | treat as policy, not as a technical failure |
| **error** | provider, network, fatal tool, validation | classify transient vs permanent |

In this SDK the signals arrive **typed** on the `RunResult`: `status`,
`stoppedAtIterationLimit`, `stoppedByDoomLoop`, `tripwire`, `error`, `usage`, `cost` —
verified in `packages/sdk/src/types/run.ts`.[^types] The full signal catalog, including the
`RunEvent` channel, is [run signals](/sdk/run-signals.md).

# The expensive one

> **Silent truncation is the costliest agent bug.**

The loop stops at the ceiling, returns a plausible-looking text, and the caller believes it
finished. An honest system exposes the signal — and your code has to read it:

```typescript
const result = await run.wait();

if (result.stoppedAtIterationLimit === true) {
  // It did NOT finish. Decide: continue, report truncation, or escalate.
}
if (result.stoppedByDoomLoop === true) {
  // No progress. Raising the ceiling only costs more — investigate the tool.
}
```

Note the two branches lead to opposite actions. Confusing them is the trap described in
[doom loop](/concepts/doom-loop.md): raising `maxIterations` to "fix" a no-progress state
buys a more expensive version of the same failure.

# Continuation is mechanical, not a product decision

When a run ends at the ceiling and the work is truncated, continuing is not a judgment call.
There is a driver for it:

```typescript
const res = await agent.runToCompletion?.("Refactor the billing module", {
  maxRounds: 5,                 // ceiling on re-sends (default 5)
  continuationPrompt: "continue",
  onTruncated: ({ round }) => metrics.increment("agent.truncated", { round }),
});

// terminal: "done" | "step_limit" | "no_progress"
if (res?.terminal === "step_limit") alert("did not finish in 5 rounds");
```

It returns `terminal`, `rounds`, `lastResult` and `usage` **summed across all rounds**. The
aggregated `usage` is the honest minimum for a continuation driver: without it, the real cost
of a task that needed four re-sends is invisible.

The `?.` is not decorative defensiveness — `runToCompletion` is declared optional on
`SDKAgent`, for the same reason `Run.supports()` exists. See
[precision notes](/project/precision-notes.md).

# The three that are not failures

`cancellation`, `tripwire` and a policy `deny` are routinely misclassified as errors, and
the cost is alert fatigue:

* `cancelled` — a user closed the tab. Alerting on it trains the on-call to ignore alerts.
* `tripwire` — a guardrail did its job. `status` is `cancelled`, not `error`; see
  [guardrails](/sdk/guardrails.md).
* a permission `deny` — does not end the run at all. The deny message becomes the model's
  next observation; see [permissions](/sdk/permissions.md).

# Mastery criterion

Given an arbitrary `RunResult`, you identify which of the seven terminals occurred and
prescribe the right action — without consulting the table.

[^course]: Agent AI course, Module 2.2
[^types]: `packages/sdk/src/types/run.ts`
