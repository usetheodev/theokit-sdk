# D367 — Single-flight per `taskId` (duplicate submit returns existing handle)

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

Webhook handlers or retried callers may issue `Task.submit({ id: "x" }, ...)` twice. If the second call started a fresh run, semantics become "fan-out" instead of "idempotent submit", surprising the caller.

## Decision

If `Task.submit` is called with an `id` that already exists in the registry, return the existing `TaskHandle` without invoking the work-fn a second time. No throw, no state mutation.

## Rationale

- Same pattern as D213 (`Eval.run` single-flight per name) and D242 (Workflow single-flight per `(workflowId, runId)`).
- Idempotency makes retries safe; callers wanting fan-out generate distinct IDs.

## Consequences

- Caller cannot replace a finished/errored task with a fresh attempt using the same ID; they must use a new ID.
- The second caller does NOT observe the first run's progress events from the start unless they subscribe and the ring buffer still holds them (D372 replay buffer).
- Auto-generated UUIDs never collide; user-supplied IDs are the only source of collisions.
