# D365 — `Task.cancel` is idempotent + propagates via AbortController

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

Cancel is the most error-prone API surface for async work. Race conditions between "user clicks cancel" and "work just completed" are common. Throwing on already-cancelled or already-finished is a footgun.

## Decision

`Task.cancel(id, reason?)` returns `{ cancelled: boolean; alreadyTerminal: boolean }`:
- Unknown task ID → `{ cancelled: false, alreadyTerminal: false }`. No throw.
- Already terminal (finished/error/cancelled) → `{ cancelled: false, alreadyTerminal: true }`.
- Queued task → state transitions directly to `cancelled`. AbortController not invoked.
- Running task → `aborter.abort(reason)` triggers the work-fn to wind down naturally; registry observes the state transition.

## Rationale

- Idempotency simplifies caller retry logic.
- AbortController is the standard Node primitive for cancellation; reusing it composes with `fetch`, `child_process`, `setTimeout`, etc.
- Queued-direct transition avoids wasting a semaphore slot.

## Consequences

- `cancel` never throws; callers branching on errors must use the return shape.
- Work-fn authors must respect `signal.aborted` periodically (no enforcement at compile time).
- Cross-process cancel (EC-7) uses `cancelRequested` flag, not AbortController.
