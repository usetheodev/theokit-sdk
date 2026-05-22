# D246 — Workflow composes over runUntil/handoffs/batch via public API only — does NOT replace them

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Workflow internals NEVER reach into `internal/agent-loop`, `internal/runtime/fork-agent`, or `internal/batch`. Always via public API (`agent.send`, `agent.runUntil`, `Agent.batch`, `Handoff.create`). Steps that need handoffs use `Agent.create({ handoffs: [...] })` on the agent passed as `agentStep` target. Steps that need agentic goal pursuit use `agent.runUntil(...)` inside `kind: "fn"`.

## Rationale

Loose coupling lets each primitive evolve independently. `Workflow.send` was rejected — Workflow is not a conversational primitive, it's an orchestration primitive. Tests can mock `agent.send` without touching internal forks. Refactor of handoffs (or batch, or runUntil) doesn't ripple into workflow.

## Consequences

- Workflow public surface has ZERO references to internal modules of other features.
- Internal refactors of agent-loop / fork / batch don't break workflow.
- Composition pattern documented in `examples/workflows/` showing handoff-aware agents inside workflow steps.
