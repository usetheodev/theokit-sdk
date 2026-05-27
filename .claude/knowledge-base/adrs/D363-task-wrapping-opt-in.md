# D363 — Task wrapping is opt-in via `{ task: true }` option

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

`Agent.send`, `Agent.batch`, `Workflow.run`, and `Cron` fires are existing public APIs. Forcing every caller to pay registry overhead breaks D108 (v1.2 caller API preserved byte-by-byte).

## Decision

Wrapping is **opt-in**. Default behaviour of every existing API is unchanged. Caller enables wrapping per-call via `{ task: true }` (auto-generates ID) or `{ task: { id, meta } }`.

## Rationale

- Backward compatibility is an inviolable rule.
- Pay-for-what-you-use — callers indifferent to observability incur zero overhead.
- Discoverability via TypeScript intellisense on the options bag.

## Consequences

- Existing tests for `Agent.send`/`batch`/`Workflow.run` must remain green without modification.
- Adapter code adds a conditional branch only when `options.task` is truthy.
- For `Cron`, the option is per-job registration, not per-fire.
