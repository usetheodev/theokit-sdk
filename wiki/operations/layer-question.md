---
type: Practice
title: The layer question
description: The first question to ask of any requirement — whose layer is this? — and why "we lack X" and "X is our job" are different statements.
tags: [architecture, decision, scope, leadership]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 12.1, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 12.1 — the layer question
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: roadmap
    resource: ROADMAP.md § Capability Gap Register
    title: The gap register, where each gap carries a layer classification
---

# The question

When a requirement arrives, the first question is **not** "how do I implement this?" It is:

> **Whose layer is this?**

# What the register demonstrates

This project's `ROADMAP.md` classifies every capability gap by layer, and two of the seven
categories are the instructive ones:

| Gap | Missing capability | Class |
| --- | --- | --- |
| G1 | event-sourced core | architectural (needs an ADR) |
| G2 | durable execution **of the agent loop** | runtime candidate |
| G3 | per-session concurrent event queue | split (runtime + transport) |
| G4 | durable, typed HITL approval state | runtime candidate |
| G5 | reactivity / invalidation | architectural (depends on G1) |
| G6 | multiplayer sessions, per-participant views | **framework/PaaS — not the SDK's layer** |
| G7 | unified fleet governance pane | **framework/PaaS — not the SDK's layer** |

The full register with evidence is [capability gaps](/project/capability-gaps.md).

# The lesson

> **"We lack X" and "X is our job" are different statements.**

Teams lose quarters implementing, inside a library, things that belong to the platform above
it — and the result is a library that does two things badly. Recording "this is not our layer"
is an architectural decision, not an excuse.

The discipline this creates is small and cheap: before a gap becomes a milestone, it gets a
layer. G6 and G7 above are not backlog items waiting for capacity; they are declarations that
capacity spent there would be misspent.

# How it composes with the other decision tools

Three questions, asked in this order, kill most unnecessary work:

1. **Whose layer is this?** (this page) — if it is not ours, stop.
2. **Does it need to exist?** — [parsimony ladder](/concepts/parsimony-ladder.md) rung 1.
3. **Buy or build?** — [architecture decisions](/operations/architecture-decisions.md).

Only what survives all three gets designed. And what does get designed against a declared
boundary — like [durability boundary](/concepts/durability-boundary.md) — is designed
*against* it deliberately, which is how reliability is earned rather than assumed.

# The practice to establish

Write your own gap register, with a layer classification, and include **at least one item
marked "not our layer" with a justification**. A register with no such item usually means the
question was never actually asked. See [governance](/operations/governance.md).[^course]

[^course]: Agent AI course, Module 12.1
[^roadmap]: ROADMAP.md § Capability Gap Register
