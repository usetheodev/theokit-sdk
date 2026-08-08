---
type: Decision Guide
title: Determinism ladder
description: From pure function to free multi-agent — climb one rung at a time with justification, because every rung up costs tokens, latency and variance.
tags: [fundamentals, architecture, orchestration, decision]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 6.1 and 6.6, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 6 — orchestration, when NOT to use an agent
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# The ladder

```
more deterministic ─────────────────────────────► more autonomy

  pure function → Workflow → Squad → subagents → single agent → free multi-agent
   (zero LLM)     (fixed      (fixed   (supervisor  (tool loop)    (emergent)
                   steps)      order)   delegates)
```

**Climb one rung at a time, and only with justification.** Every rung up costs more tokens,
more latency and more variance — and all three are product regressions, not implementation
details.

# The decision table

| Requirement | Choice | Why |
| --- | --- | --- |
| Known steps, no choice | plain `fn` / ordinary code | you do not even need an LLM |
| Known steps, LLM-generated content | [`Workflow`](/sdk/workflow.md) | determinism + testable |
| Must survive a restart | [`Workflow`](/sdk/workflow.md) + `suspend()` | the only real durability here |
| Linear chain of specialists | [`Squad`](/sdk/squad-and-subagents.md) | simpler than a graph |
| Sub-task with heavy context | [subagent](/sdk/squad-and-subagents.md) | window isolation |
| Transfer of conversation ownership | handoff | peer-to-peer |
| Genuinely unpredictable order | single agent + tools | this is the agent case |
| "Let's build a multi-agent system" | **go back and justify** | almost always premature |

The last row is the most useful one in a design review.

# Where the ladder meets its siblings

This ladder answers *how deterministic*. Two other axes ask different questions, and
conflating them produces muddled designs:

* [agentic patterns](/concepts/agentic-patterns.md) — *what reasoning shape* (ReAct,
  reflection, routing, debate).
* [control cadence](/concepts/control-cadence.md) — *who authorizes the next cycle* (model,
  human, evaluator).

A system can be low on this ladder and still fully autonomous (a `Cron`-triggered workflow),
or high on it and fully human-paced (a turn-based agent).

# The rung-1 discipline

The first rung of the [parsimony ladder](/concepts/parsimony-ladder.md) — *does this need to
exist?* — eliminates more cost than any optimization further down. Applied to agents: half
the "agents" proposed in backlogs should not exist, and the other half should be workflows.

The corollary from [what is an agent](/concepts/what-is-an-agent.md) is the test: if you can
draw the flowchart before running, implement the flowchart.

# Mastery criterion

Given a business requirement, you place the solution on the ladder, justify the chosen rung,
and say what would have to become true to climb one more.[^course]

[^course]: Agent AI course, Module 6
