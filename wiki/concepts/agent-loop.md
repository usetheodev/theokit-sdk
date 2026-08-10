---
type: Concept
title: The agent loop
description: The canonical iteration from entry edge to exit edge, and the arithmetic that shows where an agent's cost actually lives.
tags: [fundamentals, architecture, cost, runtime]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 2.1 and 2.4, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 2 — anatomy of the agent loop
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: loop
    resource: packages/sdk/src/internal/agent-loop/loop.ts
    title: The loop implementation — linear and imperative by design
---

# The canonical loop

```mermaid
flowchart TD
  S["send(message)"] --> E["entry edge: assemble context<br/>system prompt + rules + skills + memory + history"]
  E --> I1["1. check limits<br/>budget, iteration, cancellation"]
  I1 --> I2["2. call the LLM<br/>context + available tools"]
  I2 --> I3{"3. model responds"}
  I3 -->|final text| D["4. decision = done"]
  I3 -->|tool calls| I5["5. validate args, authorize,<br/>execute with timeout, collect results"]
  I5 --> I6["6. append results to history"]
  I6 --> I1
  D --> X["exit edge: guardrails, redaction"]
  X --> R["RunResult { status, result, usage, cost, stop signals }"]
```

This SDK's loop is **exactly this, linearly and imperatively**
(`packages/sdk/src/internal/agent-loop/loop.ts`). That is an architectural decision with
consequences you need to know: the loop is not event-sourced, not reactive, and not
crash-resumable. See [durability boundary](/concepts/durability-boundary.md) and
[capability gaps](/project/capability-gaps.md) — the project's own `CLAUDE.md` forbids
describing it as durable or resumable.[^loop]

# The edges matter as much as the iteration

The two edges are where most consumers under-invest.

* **Entry edge** — assembling context is not plumbing, it is the single largest lever on
  quality. That is the whole of [context engineering](/concepts/context-engineering.md).
* **Exit edge** — output guardrails run here, which is why a blocked output still reports
  `usage` and `cost` while suppressing `result`. See [guardrails](/sdk/guardrails.md).

# Where the cost actually lives

The history goes in whole on **every** iteration. Therefore:

$$
\mathrm{cost}_{\text{total}} \approx \sum_{i} \left( \mathrm{tokens}_{\text{context}}(i) + \mathrm{tokens}_{\text{output}}(i) \right)
$$

and $\mathrm{tokens}_{\text{context}}$ grows **monotonically** within a run. Three practical
consequences follow, and they are not obvious:

* A tool that returns 50 KB of log does not cost "once". It costs on **every subsequent
  iteration**. The containment is `toModelOutput` — see [tools and ACI](/sdk/tools-and-aci.md).
* Reducing the **number of iterations** saves more than reducing the initial prompt.
* Prompt caching, where the provider supports it, is the highest-leverage optimization for
  agents with a large system prompt.

[Cost management](/operations/cost-management.md) orders all five levers by impact — and
notes that teams habitually start with the smallest one.

# Where it stops

The loop has seven exits, not two. Knowing all seven is the difference between a junior and
a Staff engineer on this topic: see [loop terminals](/concepts/loop-terminals.md). One of
them, [doom loop](/concepts/doom-loop.md), is a distinct state that looks like "needs more
iterations" and is not.

# Who restarts it

One cycle is described above. The orthogonal axis — **when the cycle restarts, and who
authorizes it** — decides the shape of the whole system, and is
[control cadence](/concepts/control-cadence.md).

[^course]: Agent AI course, Module 2
[^loop]: `packages/sdk/src/internal/agent-loop/loop.ts`
