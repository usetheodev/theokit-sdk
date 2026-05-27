# D362 — `TaskState` is a 5-value closed enum

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

Hermes Agent uses 7 states (`triage / todo / ready / running / blocked / done / archived`) for its kanban-style task board. The SDK is not a kanban — it tracks the lifecycle of asynchronous work.

## Decision

`TaskState = "queued" | "running" | "finished" | "error" | "cancelled"`. Closed TypeScript literal union; exhaustive `switch` with `as never` default arm.

## Rationale

- Covers 100% of any async run lifecycle (a `Run`, a `Workflow.run`, a `Batch`, a `Cron` fire).
- `triage / blocked / archived` are user-organization concerns, not runtime concerns.
- 5 states are exhaustive in `switch` blocks and easy to telemetry.

## Consequences

- Callers needing kanban semantics (lanes, blocks) build them on top using `meta`.
- Type is `export type TaskState`, never mutated post-1.0 (breaking change to extend).
- Mirrors D120 (Eval verdict 3-value enum) and D232 (Workflow Step discriminated union).
