---
slug: crew-orchestration
created_at: 2026-06-15
goal: Ship a thin createCrew convenience that composes Workflow+agentStep for sequential multi-agent teams, closing the ergonomic residual of cross-val Gap 1 without duplicating the orchestration engine.
---

# Plan: Crew orchestration ergonomics (cross-val Gap 1, narrowed)

> **Version 1.0** — DISCOVER showed Gap 1 ("no first-class multi-agent orchestration") is largely already covered: `Workflow`+`agentStep` does sequential/branching agent teams; `subagents`/`handoff` do hierarchical delegation. The genuine residual is ergonomics. This ships a thin `createCrew` that COMPOSES `Workflow`+`agentStep` (zero new orchestration logic — DRY/"don't reinvent") + a `Crew` decorator (decorator mandate).

## Goal

> "A developer can run a sequential agent team in one call, measured by: (a) `createCrew({ agents: [a1,a2,a3] }).run(input)` runs the agents in order, threading each output into the next agent's prompt, returning the final result + per-agent trace; (b) it builds on `Workflow`+`agentStep` internally (no duplicate orchestration); (c) invalid input (empty agents, `process:"hierarchical"`) fails fast with a guiding `ConfigurationError`; (d) a `Crew` decorator exists in `@theokit/di-agent`."

## Context / Baseline (current state)

| File | Role | Invariant to preserve |
|---|---|---|
| `packages/sdk/src/workflow.ts` | `Workflow.create()`, `agentStep()` — the orchestration ENGINE | reuse as-is; do NOT modify |
| `packages/sdk/src/agent-factory.ts` | `createAgentFactory` — the composition-LEGO precedent | mirror its factory shape |
| `packages/sdk/src/index.ts` | public barrel | add `createCrew` export |
| `packages/sdk/src/errors.ts` | `ConfigurationError` | reuse |
| `packages/di-agent/src/decorators/sub-agent.ts` | reflect-metadata decorator pattern | mirror for `Crew` |

Already covered (NOT rebuilt): sequential/branching teams (Workflow+agentStep), hierarchical delegation (subagents/handoff).

## Drawbacks & Risks

- **API surface growth:** adds `createCrew` (a 4th agent-composition path next to create/getOrCreate/factory/builder). Mitigation: it is thin sugar over Workflow; docs steer crewAI users here; KISS — sequential MVP only.
- **Risk of duplicating Workflow:** Mitigation — `createCrew` MUST delegate to `Workflow`+`agentStep`; a test asserts the underlying run is a `WorkflowRun`. No scheduling/branch logic re-implemented.
- **Hierarchical omitted:** Mitigation — `process:"hierarchical"` throws a `ConfigurationError` pointing to subagents/handoff (which already cover it); honest, no half-baked manager engine.

## Tasks

### Task 1 — `createCrew` factory composing Workflow+agentStep (TDD)
- #### Why this step: the genuine residual is an ergonomic wrapper; composition (not reimplementation) respects DRY + "don't reinvent".
- #### TDD: `test_createCrew_runs_agents_sequentially_threading_output` (3 fake agents; assert each receives prior output, final result = last agent output); `test_createCrew_returns_per_agent_trace`; `test_rejects_empty_agents` (ConfigurationError `invalid_crew`); `test_rejects_hierarchical_with_guidance` (ConfigurationError `crew_process_unsupported`, message points to subagents/handoff); `test_default_process_is_sequential`.
- #### Acceptance: `createCrew({agents}).run(input)` threads outputs via an internal `Workflow`; returns `{ result, steps }`; pure composition (the run is produced by `Workflow.run`).

### Task 2 — `Crew` decorator in `@theokit/di-agent` (TDD — decorator mandate)
- #### Why this step: Rule 9 / decorator mandate — every agentic capability ships a decorator alongside the factory.
- #### TDD: `test_Crew_decorator_stores_metadata` (decorate a property, read back via `readCrewMetadata`); mirrors sub-agent.test.
- #### Acceptance: `Crew(options)` PropertyDecorator stores metadata via reflect-metadata; `readCrewMetadata(target)` returns it.

### Task 3 — Docs + CHANGELOG
- #### Why this step: new public API → docs.md (source of truth) + CHANGELOG (Rule 6).
- #### Acceptance: docs.md gets a short "Crew (sequential teams)" subsection noting it composes Workflow+agentStep and that hierarchical = subagents/handoff; `packages/sdk/CHANGELOG.md` + `packages/di-agent/CHANGELOG.md` + root CHANGELOG `[Unreleased] § Added`.

## Coverage Matrix

| Goal claim | Task |
|---|---|
| createCrew runs agents sequentially, threading output→input | T1 |
| returns final result + per-agent trace | T1 |
| builds on Workflow+agentStep (no duplicate engine) | T1 |
| empty agents / hierarchical → guiding ConfigurationError | T1 |
| Crew decorator in di-agent | T2 |
| docs + changelog | T3 |

## Test Plan
- Unit: createCrew threading + validation with fake agents (no real LLM) — Task 1.
- Unit: Crew decorator metadata round-trip — Task 2.
- Integration: createCrew().run() produces a WorkflowRun (delegation proof) — Task 1.
- Regression: full sdk + di-agent suites green.

## Unresolved Questions
- (none for MVP) — hierarchical is intentionally deferred to existing subagents/handoff; per-agent prompt templates default to identity threading (customization is a future, YAGNI for MVP).

## Prior Art
- In-repo: `createAgentFactory` (composition-LEGO precedent), `Workflow`+`agentStep` (engine), `sub-agent` decorator (decorator pattern).
- Reference: crewAI `Crew`/`Process` (ergonomic inspiration; engine NOT copied).

## Rationale & Alternatives
- **Chosen:** thin `createCrew` composing Workflow+agentStep + decorator. DRY, KISS, closes the ergonomic gap.
- **Rejected:** a standalone Crew orchestration engine — duplicates Workflow (DRY/YAGNI/"don't reinvent" violation).
- **Rejected:** docs-only — leaves the discoverability gap (crewAI users still find no "crew" symbol).
