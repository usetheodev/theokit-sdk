---
type: Limitation Register
title: Capability gaps
description: G1-G7 — what this SDK does not do, each classified by layer, with the honesty rules that govern how they may be described.
tags: [project, limitations, honesty, roadmap, architecture]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: roadmap
    resource: ROADMAP.md § Capability Gap Register
    title: The authoritative register (recorded 2026-07-22)
  - id: claudemd
    resource: CLAUDE.md § Known capability gaps
    title: Project contract — the honesty rules for this area
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 12.1, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 12.1 — the layer classification of each gap
---

# What this register is

The SDK is an **imperative, in-process agent harness** — the agent loop is deliberately
*linear* (`internal/agent-loop/loop.ts`). It is **not** an event-sourced, reactive or
multi-participant agent engine. A 2026-07-22 capability comparison against durable-execution
and collaborative runtimes recorded seven gaps.

**None is shipped, and several are not the SDK's layer at all.** The authoritative version
lives in `ROADMAP.md`; this concept is the navigable copy.

# The seven

| Gap | Capability the SDK does NOT have today | Class |
| --- | --- | --- |
| **G1** | Event-sourced core (typed state items · event queue · effects) | Architectural (ADR-gated) |
| **G2** | Durable execution of the **agent loop** — resume mid-loop after a crash. Agents persist *messages* only, fire-and-forget; only **Workflow** resumes, and only at explicit `suspend()` | Runtime-candidate (ADR-gated) |
| **G3** | Concurrent-signal handling / per-session event queue (`a2a` is fire-and-forget, no queue) | Split (runtime inbox + framework transport) |
| **G4** | Durable, **typed** HITL approval state (`pending`/`approved`/`denied`/`invalidated`). Today tool-gate HITL is ephemeral; workflow suspend is durable but untyped | Runtime-candidate |
| **G5** | Reactivity / invalidation (external data → a prior decision goes stale → re-evaluate). The `invalidate*` methods in-tree are prompt-cache only | Architectural (depends on G1) |
| **G6** | Multiplayer sessions · per-participant views · cross-UI sync (`a2a` is in-process, not shared or durable) | **Framework/PaaS-owned** |
| **G7** | Agent Manager (unified fleet governance pane). The SDK exports telemetry + `RunEvent`, ships no pane | **Framework/PaaS-owned** |

# The honesty rules

These are contractual, from `CLAUDE.md`:

* **Do not describe the agent loop as durable or crash-resumable.** It resumes *conversation*,
  not execution. Only the Workflow DSL has durable execution, and only at `suspend()`
  boundaries. See [durability boundary](/concepts/durability-boundary.md).
* **Do not describe HITL as durable** unless it goes through workflow suspend/resume. The
  tool-gate HITL is in-memory and dies with the process. See
  [human in the loop](/concepts/human-in-the-loop.md).
* **G6 and G7 are not SDK gaps.** Multiplayer shared sessions and the governance pane belong
  to the framework/PaaS layer. Never file them as SDK work without an owner ADR. See
  [the layer question](/operations/layer-question.md).
* No G1–G7 milestone is accepted; each needs an owner ADR before code. Grep the evidence, cite
  the register, then claim.

# Why a register like this is unusual

It is the most uncommon engineering artifact in this repository: **an official place where the
limitations are written down before anyone promises the opposite.** That is listed as one of
the four genuine differentiators in
[framework comparison](/ecosystem/framework-comparison.md), and it is governance item 1 in
[governance](/operations/governance.md).

The transferable habit: **look for the record of limitations before promising a capability.**
A project that keeps one is telling you where not to build. A project without one is telling
you nothing — which is not the same as telling you it is fine.[^roadmap]

[^roadmap]: ROADMAP.md § Capability Gap Register
[^claudemd]: CLAUDE.md § Known capability gaps
