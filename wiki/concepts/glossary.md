---
type: Glossary
title: Agent engineering terms
description: What the recurring terms in this bundle mean, in one place, with a pointer to the concept that develops each.
tags: [terminology, vocabulary]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Appendix D, absorbed into this bundle 2026-08-06
    title: Agent AI course, Appendix D — glossary
    author: human:paulohenriquevn
    last_modified: 2026-07-30
---

# Terms

ACI
: Agent-Computer Interface — the design of the tool surface exposed to the model. Developed
  in [tools and ACI](/sdk/tools-and-aci.md).

Agent
: A program in which an LLM decides, in a loop, which action to take next, until it judges
  the task complete. See [what is an agent](/concepts/what-is-an-agent.md).

Closed autonomous loop
: Chains runs with no human pause; a completion criterion decides whether to continue
  (`runUntil`, `Cron`). See [control cadence](/concepts/control-cadence.md).

Control cadence
: Who authorizes the next cycle — the model (ReAct), the human (turn-based), or an automatic
  evaluator (closed loop). See [control cadence](/concepts/control-cadence.md).

Doom loop
: Identical tool calls repeated with no progress. A terminal state of its own, not a shortage
  of iterations. See [doom loop](/concepts/doom-loop.md).

Guardrail
: An input or output processor that may block. See [guardrails](/sdk/guardrails.md).

HITL
: Human in the loop — a human decides one specific action inside a loop that otherwise stays
  autonomous. Two seams with different guarantees: the **tool gate** (`canUseTool` —
  ephemeral, dies with the process) and the **workflow suspend** (`ctx.suspend` +
  `Workflow.resume` — durable, resumed by `runId`). See
  [human in the loop](/concepts/human-in-the-loop.md).

MCP
: Model Context Protocol, for out-of-process tool servers. See
  [MCP integration](/sdk/mcp-integration.md).

ReAct
: Reason + act in a loop; the *inner* cycle of a single run. See
  [the agent loop](/concepts/agent-loop.md).

Silent truncation
: Stopping at the iteration ceiling while appearing to have finished. The costliest agent
  bug. See [loop terminals](/concepts/loop-terminals.md).

Skill
: An instruction package retrievable by name and description — retrieval of *capability*
  rather than of data. See [context engineering](/concepts/context-engineering.md).

Tripwire
: A block fired by a guardrail. Reported as `status: "cancelled"`, never as an error. See
  [guardrails](/sdk/guardrails.md).

Turn-based
: One run at a time; the human closes the cycle by sending the next message. The correct
  default for most products. See [control cadence](/concepts/control-cadence.md).

Wiring triad
: Caller + integration test + runtime metric — this project's definition of "done". A feature
  with no runtime metric is invisible when it breaks. See
  [governance](/operations/governance.md).
