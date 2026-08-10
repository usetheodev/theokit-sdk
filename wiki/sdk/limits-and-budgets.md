---
type: API Guide
title: Limits and budgets
description: The ceilings that do not depend on the model cooperating — iteration cap, budget tracker, per-tool timeout, doom-loop guard and cancellation — and why a gate must fail closed.
tags: [reliability, limits, budget, cost, fail-closed]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 7.2, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 7.2 — limits that do not depend on the model
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: loop
    resource: packages/sdk/src/internal/agent-loop/loop.ts
    title: evaluateBudgetGate, nextIteration and track call sites — read 2026-07-30
---

# The full set

```typescript
import { Agent, createCounterBudgetTracker } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  budgetTracker: createCounterBudgetTracker({ maxIterations: 50 }),
  local: { cwd: process.cwd() },
});

const run = await agent.send("Long task", {
  maxIterations: 12,          // per-send ceiling (loop default: 8)
  perToolTimeoutMs: 15_000,   // per tool call
  doomLoop: { softThreshold: 3, hardThreshold: 5 },
  signal: controller.signal,  // cooperative cancellation
});

const result = await run.wait();
if (result.stoppedAtIterationLimit === true) {
  // Did NOT finish. Decide: continue, report truncation, or escalate.
}
if (result.stoppedByDoomLoop === true) {
  // No progress. Raising the cap only costs more — investigate the tool.
}
```

Reading those two flags is not optional. Not reading them is
[silent truncation](/concepts/loop-terminals.md), the costliest agent bug.

# Fail-closed matters

In this SDK, a `budgetTracker` that throws **denies** the iteration rather than letting it
through (`loop.ts`, `evaluateBudgetGate`). That is the correct behavior for a gate: **when in
doubt, deny.** A gate that opens when it breaks is not a gate.

The same property appears in [permissions](/sdk/permissions.md) (unmatched ⇒ `ask`, and no
gate on an `ask` ⇒ block) and in the HITL timeout rule
([human in the loop](/concepts/human-in-the-loop.md): silence means denied). Three different
mechanisms, one invariant — worth copying into your own authorization code.

# A verified divergence you can rely on

> The docstring on `AgentOptions.budgetTracker` says the option is "type-surface only, with no
> runtime enforcement". **The code contradicts the comment.** `internal/agent-loop/loop.ts`
> calls `evaluateBudgetGate(inputs.budgetTracker)` before each iteration (line 80), advances
> `nextIteration()` (line 109), and calls `track(...)` after each completion (lines 365/372).
>
> **The enforcement exists and you can depend on it.** The comment is stale.[^loop]

The transferable lesson, and the reason this note is here rather than buried: **when the
docstring and the code disagree, the code is the truth.** The divergence is a documentation
defect to be reported, not an ambiguity to be worked around. The real cost of that drift is
concrete — a consumer who reads the comment concludes they must build their own budget
control and writes redundant code for a mechanism that already works.

The full list of such divergences is [precision notes](/project/precision-notes.md).

# Which limit answers which risk

| Risk | Limit |
| --- | --- |
| Model keeps asking for tools forever | `maxIterations` (per send) or `budgetTracker` (per agent) |
| A single tool hangs | `perToolTimeoutMs` |
| Same failing call repeated | `doomLoop` guard, on by default |
| User closed the tab | `signal` — and `cancelled` is not an error |
| Tenant exceeded its plan | `onBeforeSend` — a **blocking** hook; see [observability](/operations/observability.md) |
| Goal-level spend in a closed loop | `tokenBudget` on `runUntil` — [control cadence](/concepts/control-cadence.md) |

None of these depend on the model cooperating, which is the entire point. Ceilings that live
in the prompt are suggestions — see [attack surface](/concepts/attack-surface.md).[^course]

[^course]: Agent AI course, Module 7.2
[^loop]: `packages/sdk/src/internal/agent-loop/loop.ts`, read 2026-07-30
