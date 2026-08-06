---
type: Concept
title: Control cadence
description: The axis that decides the shape of the whole system — whether the model, a human, or an automatic evaluator authorizes the next cycle.
tags: [fundamentals, architecture, autonomy, risk]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 2.5, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 2.5 — control cadence
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/sdk-agent.ts
    title: SDKAgent optional methods — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# The axis

[The agent loop](/concepts/agent-loop.md) describes **one** cycle. The missing axis decides
the shape of the entire system: **when the cycle restarts, who authorizes it?**

This axis is orthogonal to the other two the course uses — the reasoning pattern
([agentic patterns](/concepts/agentic-patterns.md)) and the degree of determinism
([determinism ladder](/concepts/determinism-ladder.md)) — and it is what separates a chatbot
from a nightly routine.

| | **ReAct** | **Turn-based** | **Closed autonomous** |
| --- | --- | --- | --- |
| Cycle scope | one iteration inside a run | one whole run | several chained runs |
| Who continues | the model (asks for another tool) | **the human** (sends the next message) | **an automatic evaluator** |
| Who stops | the model, on final text | the human, by sending nothing more | the completion criterion, the budget or the ceiling |
| Perceived latency | seconds | interactive | minutes to hours |
| Where it costs most | a badly described tool | — | **an error propagates with no witness** |

# ReAct — the inner cycle

Reason → act → observe, repeated inside **one** `send`. You do not switch it on; it is what
an agent with tools does. Control belongs to the model and the limit is external:

```typescript
const run = await agent.send("Investigate why the build broke", {
  maxIterations: 12, // ReAct ceiling for this send (loop default: 8)
});
```

The other two cadences **contain** ReAct; they do not replace it.

# Turn-based — the human closes the cycle

The agent runs its inner cycle and returns. Nothing else happens until a new message. This
is the pattern of chat, of a copilot, of an interactive CLI:

```typescript
const r1 = await (await agent.send("Find the bug in src/auth.ts")).wait();
// ... the human reads, evaluates, decides ...
const r2 = await (await agent.send("Fix it and add a regression test")).wait();
```

It looks like the least advanced mode and is in fact **the correct default for most
products**. The pause between turns is not a limitation: it is the cheapest human review
point that exists. Give it up only when you have a trustworthy automatic evaluator to put in
its place — which is exactly what the third cadence demands.

There is an important hybrid: the run ended at the iteration ceiling and the work is
truncated. Continuing there is mechanical, not a product decision — see the
`runToCompletion` driver in [loop terminals](/concepts/loop-terminals.md).

# Closed autonomous — the machine closes the cycle

No human between cycles. Something has to judge "is it done?" and decide to continue or
stop. Here the judgment is an LLM-as-judge and the loop is `runUntil`:

```typescript
for await (const ev of agent.runUntil?.("All billing tests passing", {
  maxTurns: 20,                      // hard ceiling against an infinite loop (default 20)
  tokenBudget: 500_000,              // stops with status "budget_limited" when crossed
  maxConsecutiveJudgeFailures: 3,    // unreadable judge 3× in a row ⇒ give up (default 3)
  judgeModel: "openai/gpt-4o-mini",
  subgoals: ["fix the tax calculation", "cover the refund case"],
  signal: controller.signal,
}) ?? []) {
  console.log(ev);
}
// GoalResult.status: "completed" | "failed" | "paused" | "budget_limited" | "blocked"
```

Look at the five final statuses. Only **one** is success. A well-designed closed loop spends
most of its design time on the other four — and `budget_limited` existing as its own status,
rather than collapsing into `failed`, is the difference between "we ran out of money" and
"the work is wrong". Confusing those two sends the team to investigate the wrong bug.

Other closed triggers: `Cron.create(...)` fires on time
([concurrency and scheduling](/operations/concurrency-and-scheduling.md));
`SendOptions.completionCheck` judges **one** send rather than the whole goal;
[`Squad` and subagents](/sdk/squad-and-subagents.md) close the cycle by delegation.

# Why a closed loop is a different risk category

In the first two cadences a human sees every result. In the third nobody does, and that is
where the failure modes stop being theory:

| Risk | Why it only bites in a closed loop | Containment |
| --- | --- | --- |
| **Runaway cost** | nobody notices the 40th iteration; context grows on each one | `tokenBudget`, `budgetTracker`, per-tenant ceiling — [limits and budgets](/sdk/limits-and-budgets.md) |
| **Doom loop** | with no human, it repeats indefinitely | guard on by default, soft 3 / hard 5 — [doom loop](/concepts/doom-loop.md) |
| **Destructive action** | there is no confirmation on the path | fail-closed permissions; `deny` immune to mode — [permissions](/sdk/permissions.md) |
| **Indirect injection** | hostile tool content acts without review | `toolResultGuard: { delimit: true }` — [attack surface](/concepts/attack-surface.md) |
| **Complacent judge** | the loop declares its own success | calibrate the judge against human labels — [evaluation](/operations/evaluation.md) |
| **Silent drift** | small errors accumulate across rounds | eval in CI + `onRunEvent` for audit — [observability](/operations/observability.md) |

The most treacherous is the fifth: **in a closed loop the evaluator is the only witness.** A
badly calibrated judge does not produce an error — it produces a success report. That is why
`completionCheck` treats an unreadable judge as `complete: false` rather than assuming
approval.

# Progression rule

Start turn-based. Close the cycle only when you have (a) a completion criterion you can
measure, (b) a budget with a hard ceiling, and (c) fail-closed permissions. Missing any of
the three, a closed loop is an expensive way to be wrong with nobody looking.

The common middle case — an autonomous loop where **one specific action** needs a human —
is [human in the loop](/concepts/human-in-the-loop.md).[^course]

[^course]: Agent AI course, Module 2.5
