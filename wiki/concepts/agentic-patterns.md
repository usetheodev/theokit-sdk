---
type: Taxonomy
title: Agentic patterns
description: The nine recurring agentic patterns with what each is for and what it costs, plus the seniority rule about which to start from.
tags: [fundamentals, patterns, vocabulary, cost]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 1.3, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 1.3 — taxonomy of agentic patterns
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# The catalog

Vocabulary for design discussions and code review. Cost is expressed relative to a single
tool-use loop.

| Pattern | What it is | When to use | Typical cost |
| --- | --- | --- | --- |
| **Tool use / ReAct** | reason → act → observe, in a loop | the base of everything | 1 LLM call per iteration |
| **Reflection** | the agent critiques and revises its own output | quality over latency | 2–3× |
| **Planning** | an explicit plan before acting | long multi-step tasks | +1 call, reduces rework |
| **Routing** | classify and dispatch to a specialist | heterogeneous domains | +1 cheap call |
| **Prompt chaining** | one output becomes the next input | deterministic | linear |
| **Parallelization** | independent fan-out, then aggregate | independent tasks | parallelizable |
| **Orchestrator–worker** | a supervisor delegates to subagents | dynamic decomposition | high |
| **Evaluator–optimizer** | generator + critic in a loop until it passes | measurable quality | high, convergent |
| **Multi-agent debate** | N agents disagree and converge | ambiguous decisions | very high |

# The seniority insight

The patterns at the bottom of the table are almost always the wrong answer for a first
release. **Start at tool use; climb the ladder only when you have measurement telling you
to.** Measurement means [evaluation](/operations/evaluation.md), not intuition.

The cost column is the reason. Each row below tool use multiplies LLM calls, and every call
carries the whole context — see the cost arithmetic in [the agent loop](/concepts/agent-loop.md).

# How the patterns map onto this SDK

The patterns are framework-agnostic; the mapping is not.

| Pattern | Where it lives here |
| --- | --- |
| Tool use / ReAct | the agent loop itself — you do not enable it, it is what an agent with tools does |
| Prompt chaining, parallelization | [`Workflow`](/sdk/workflow.md) `.then` / `.parallel` |
| Routing | [`Workflow`](/sdk/workflow.md) `.branch`, or a cheap classifier agent |
| Orchestrator–worker | [subagents](/sdk/squad-and-subagents.md) — one delegation tool per declared child |
| Prompt chaining across specialists | [`Squad`](/sdk/squad-and-subagents.md) — each agent's output feeds the next |
| Evaluator–optimizer | `runUntil` with a judge, described in [control cadence](/concepts/control-cadence.md) |
| Reflection, multi-agent debate | consumer-side policy; the harness exposes the seam, not a packaged ladder |

That last row is deliberate honesty rather than an omission — see
[capability gaps](/project/capability-gaps.md).

# Choosing

The pattern question comes *after* the prior question: should this be an agent at all? Run
[determinism ladder](/concepts/determinism-ladder.md) first. A routing pattern implemented
as a workflow branch costs one cheap call; the same routing "emerging" from an agent costs
the whole loop.[^course]

[^course]: Agent AI course, Module 1.3
