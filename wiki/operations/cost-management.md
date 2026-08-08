---
type: Practice
title: Cost management
description: The five cost levers in impact order, why teams reach for the smallest one first, and the accounting rule that unknown cost is never reported as zero.
tags: [operations, cost, budget, finops, honesty]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 11.2, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 11.2 — cost, measure, budget, attribute
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/ (usage, cost, computeCost, UsageAccumulator)
    title: Cost surface — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# Measure

```typescript
import { computeCost, normalizeUsage, getPricingEntry, UsageAccumulator } from "@theokit/sdk";

const result = await run.wait();
console.log(result.usage, result.cost); // cost.status says how much to trust it
```

> **Unknown cost is never reported as zero.** Zero is a number; unknown is the absence of a
> number. Collapsing the two produces reports that add up neatly and lie.

The same rule appears as `costAmountUsd` returning `undefined`
([agent, run and SDKMessage](/sdk/agent-run-sdkmessage.md)) and as `usage` being preserved on
an output block ([guardrails](/sdk/guardrails.md)). It is one invariant expressed in three
places — worth copying into your own accounting code, because the failure it prevents is
silent.

# The five levers, in impact order

1. **Reduce iterations** — the whole context enters on every one.
2. **Reduce tool-result size** — `toModelOutput`, see [tools and ACI](/sdk/tools-and-aci.md).
3. **Prompt caching** — for a large, stable system prompt.
4. **A cheaper model for sub-tasks** — routing, summarizing, judging.
5. **Compact history earlier** — see [context engineering](/concepts/context-engineering.md).

**In that order.** Teams habitually start at 4 (swap the model) because it is the most
visible, and ignore 1 and 2, which are larger. The arithmetic that makes 1 and 2 dominant is
in [the agent loop](/concepts/agent-loop.md): context grows monotonically within a run, so a
50 KB tool result is not paid once — it is paid on every subsequent iteration.

# Budget

Measuring without a ceiling is a report, not a control. The ceilings are in
[limits and budgets](/sdk/limits-and-budgets.md):

| Scope | Mechanism |
| --- | --- |
| Per send | `maxIterations` |
| Per agent | `budgetTracker` — fail-closed |
| Per goal, closed loop | `tokenBudget` on `runUntil` |
| Per tenant | a blocking `onBeforeSend` hook |

The per-tenant one is the only place where a business rule meets the loop, and it belongs on
a **blocking** hook — see [observability](/operations/observability.md) for which hooks block.

# Attribute

Cost per run, tagged to a tenant or user, is the difference between "the bill went up" and
"tenant 42's nightly job went up". Without attribution the only available response to a cost
spike is to turn things off.

Attribution is also what makes a closed loop safe to run at all: `budget_limited` existing as
its own terminal status, distinct from `failed`, is only useful if you can say *whose* budget
— see [control cadence](/concepts/control-cadence.md).

# Mastery criterion

You take an agent that is "expensive" and rank the five levers against its actual measured
profile — rather than reaching for the model swap first.[^course]

[^course]: Agent AI course, Module 11.2
