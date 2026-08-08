---
type: Concept
title: Durability boundary
description: What actually survives a crash in this SDK — the conversation resumes, the execution does not — and the architectural consequence of that line.
tags: [architecture, durability, workflow, honesty, limits]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 6.3, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 6.3 — the durability point
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: claudemd
    resource: CLAUDE.md § Known capability gaps
    title: Project contract — forbids describing the loop as durable or crash-resumable
  - id: gaps
    resource: ROADMAP.md § Capability Gap Register, gaps G2 and G4
    title: Durable execution of the agent loop, and durable typed HITL state
---

# The line

This is the most important distinction in the orchestration story, and the easiest to get
wrong in an interview or an ADR:

> In `@theokit/sdk`, **the agent loop is not durable.** It does not resume execution
> mid-loop after a crash. What resumes is the **conversation** — via the session transcript.
>
> **Durable execution exists only in `Workflow`, and only at `suspend()` boundaries.**

# What that means concretely

| Thing | Survives a process death? | Mechanism |
| --- | --- | --- |
| Run state (loop variables, current iteration) | **no** | in-process only, and that is fine |
| Conversation history | **yes** | session transcript — [state, sessions and memory](/sdk/state-sessions-memory.md) |
| Workflow execution paused at `suspend()` | **yes** | snapshot, resumed by `runId` — [workflow](/sdk/workflow.md) |
| A tool-gate HITL approval waiting on a `Promise` | **no** | in memory; dies with the process — [human in the loop](/concepts/human-in-the-loop.md) |
| Memory facts | **yes** | the memory backend |

Agents persist *messages* only, and that persistence is fire-and-forget. Resuming an agent
replays a conversation; it does not replay a half-finished tool dispatch.

# The architectural consequence

If your requirement is "this 40-minute operation must survive a deploy in the middle", then
the part that must survive **has to be in a workflow with suspension points** — not in an
agent loop.

This is not a limitation to be worked around with creativity. It is the boundary of what the
tool guarantees, and designing *against* a stated boundary is how reliability is earned.
Designing *past* one is how outages are earned.

# Why it is written down

The gap is registered explicitly as **G2** in `ROADMAP.md` § *Capability Gap Register*, and
`CLAUDE.md` forbids describing the loop as resumable.[^claudemd] The related **G4** says the
same about typed HITL approval state.

Learn the habit the register teaches: **look for the record of limitations before promising
a capability.** A project that keeps such a register is telling you where not to build; a
project without one is telling you nothing, which is not the same as telling you it is fine.

The full register is [capability gaps](/project/capability-gaps.md), and the reasoning about
whose layer each gap belongs to is [the layer question](/operations/layer-question.md).

# Comparison

If durable execution *of the loop* is your dominant requirement, the state-graph family is
where it is native. [Framework comparison](/ecosystem/framework-comparison.md) § when to
choose something else says so plainly.[^course]

[^course]: Agent AI course, Module 6.3
[^claudemd]: CLAUDE.md § Known capability gaps
