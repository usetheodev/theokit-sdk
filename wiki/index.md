---
okf_version: "0.2"
---

# theokit-sdk wiki

Knowledge bundle for **`@theokit/sdk`**, the Harness pillar of the Theo stack. Absorbs the
former `docs/` tree (reference + the 12-module Agent AI course) and the former
`.claude/knowledge-base/` cycle records into one navigable set of concepts.

**The exported TypeScript types remain the canonical public contract.** Where anything here
disagrees with the types, the types win — see [precision notes](project/precision-notes.md)
for the divergences already found.

# Reference

Shipped inside the npm tarball (`node_modules/@theokit/sdk/docs/`), so these two are pinned
to the version a consumer installed.

* [Harness capability map](reference/harness-capability-map.md) - Every public primitive with its real import path and a minimal example.
* [Error codes](reference/error-codes.md) - The `AgentRunError.code` union and the provider-to-code mapping.

# Concepts

Framework-agnostic fundamentals. This is what transfers when you change stacks.

* [What is an agent](concepts/what-is-an-agent.md) - The minimal definition and the four mandatory components.
* [Agentic patterns](concepts/agentic-patterns.md) - Tool use, reflection, planning, routing, orchestrator-worker and the rest, with their costs.
* [The agent loop](concepts/agent-loop.md) - The canonical iteration, edge to edge, and where cost actually lives.
* [Loop terminals](concepts/loop-terminals.md) - The seven ways a run ends and what the caller owes each one.
* [Doom loop](concepts/doom-loop.md) - Identical repeated tool calls: the no-progress terminal, distinct from needing more iterations.
* [Control cadence](concepts/control-cadence.md) - Who authorizes the next cycle: the model (ReAct), a human (turn-based) or an evaluator (closed-loop).
* [Human in the loop](concepts/human-in-the-loop.md) - The two HITL seams and the durability difference that causes incidents.
* [Context engineering](concepts/context-engineering.md) - The context window as a budgeted scarce resource, and the four operations on it.
* [Determinism ladder](concepts/determinism-ladder.md) - From pure function to free multi-agent; climb one rung at a time, with justification.
* [Durability boundary](concepts/durability-boundary.md) - What actually survives a crash here, and what does not.
* [Attack surface](concepts/attack-surface.md) - The six vectors every agent exposes, and where each is contained.
* [Parsimony ladder](concepts/parsimony-ladder.md) - Stop at the first rung that resolves the need; what the ladder may never sacrifice.
* [Pitfalls](concepts/pitfalls.md) - The recurring traps, each paired with its antidote.
* [Glossary](concepts/glossary.md) - What the recurring terms mean, in one place.

# SDK

The primitives in practice.

* [Agent, Run and SDKMessage](sdk/agent-run-sdkmessage.md) - The three core objects, their lifecycles and the three ways to invoke.
* [Observation channels](sdk/observation-channels.md) - Why messages, deltas and events are three separate channels.
* [Tools and ACI](sdk/tools-and-aci.md) - Designing a tool surface a strange user gets right on the first try.
* [MCP integration](sdk/mcp-integration.md) - When not to write the tool yourself, and the `mcpLifecycle` trade-off.
* [Workflow](sdk/workflow.md) - Deterministic steps that may call an LLM, and the only durable execution here.
* [Squad and subagents](sdk/squad-and-subagents.md) - Sequential teams and delegation; the real reason is context isolation.
* [Failure taxonomy](sdk/failure-taxonomy.md) - Six failure classes and the right response to each.
* [Limits and budgets](sdk/limits-and-budgets.md) - Ceilings that do not depend on the model cooperating.
* [Permissions](sdk/permissions.md) - First matching rule wins, fail-closed, evaluated without an LLM.
* [Guardrails](sdk/guardrails.md) - Input and output processors, and the accounting asymmetry between them.
* [State, sessions and memory](sdk/state-sessions-memory.md) - Four kinds of state and the right mechanism for each.
* [Run signals](sdk/run-signals.md) - Every terminal signal a `RunResult` or `RunEvent` carries and what it means.
* [Import map](sdk/import-map.md) - All ~30 sub-entries in one place, grouped by task.

# Operations

Proving it works, and running it.

* [Evaluation](operations/evaluation.md) - Datasets, scorers, CI gates and calibrating an LLM judge.
* [Observability](operations/observability.md) - The three layers, and which hooks block versus observe.
* [Cost management](operations/cost-management.md) - The five levers in impact order, and why unknown cost is never zero.
* [Concurrency and scheduling](operations/concurrency-and-scheduling.md) - Bounded pools, resumable batches and scheduled work.
* [Production readiness checklist](operations/production-readiness-checklist.md) - Fifteen lines, each one a real failure of a real system.
* [The layer question](operations/layer-question.md) - "We lack X" and "X is our job" are different statements.
* [Architecture decisions](operations/architecture-decisions.md) - ADRs that survive hostile review, and buy-vs-build in Agent AI.
* [Governance](operations/governance.md) - What a Staff engineer establishes before the team scales.

# Ecosystem

* [Framework comparison](ecosystem/framework-comparison.md) - Six deciding axes, the architectural families, and honest recommendations to pick something else.

# Curriculum

The teaching track. Not an API contract.

* [Course overview](curriculum/course-overview.md) - Audience, honesty contract, structure and setup.
* [Labs](curriculum/labs.md) - Every lab, by module, with its objective and duration.
* [Capstone](curriculum/capstone.md) - The final project: scope, deliverables and grading rubric.
* [Competency rubric](curriculum/competency-rubric.md) - Junior to Staff, per dimension.

# Project

Records about this repository rather than about agents.

* [Theo stack](project/theo-stack.md) - The four pillars and where the Harness sits.
* [Capability gaps](project/capability-gaps.md) - G1-G7: what this SDK does not do, classified by layer.
* [Precision notes](project/precision-notes.md) - Where code and docstrings diverge, and which one wins.
* [Review: issue-sweep 2026-08](project/review-issue-sweep-2026-08.md) - 34 findings, two BLOCKERs, three published retractions, and the closure record.
* [Audit: code quality 2026-08](project/audit-code-quality-2026-08.md) - PASS_WITH_CAVEATS, and the three detectors that never reported.
* [Grill: review remediation](project/grill-review-remediation.md) - How the 2026-07-23 review findings became milestones SE47-SE52.
