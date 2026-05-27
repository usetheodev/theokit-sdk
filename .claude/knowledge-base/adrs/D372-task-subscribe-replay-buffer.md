# D372 — `Task.subscribe` ring buffer (cap 64) for late-attach replay

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

Tasks may complete before a subscriber attaches (cron tick fired in ms). Without a buffer, late subscribers receive nothing and falsely conclude "no events".

## Decision

Each task has a ring buffer of capacity 64 holding the most recent `TaskEvent`s. `Task.subscribe(id)`:
1. Drains the buffer (yields all stored events first).
2. If the buffer was at capacity, marks the first yielded event with `truncated: true`.
3. Registers a live subscriber that yields subsequent events.

## Rationale

- 64 events covers most task lifecycles end-to-end.
- Bounded memory — long-running tasks emitting thousands of progress events do not leak.
- The `truncated` flag tells the subscriber "you missed earlier events; reconstruct state from `Task.get` if needed".

## Consequences

- Subscriber attaching very late to a long task may see only the last 64 events.
- `RingBuffer` is a new internal primitive (`internal/task/ring-buffer.ts`).
- Events evicted on task terminal+retention boundary; subscriber attached after eviction throws `TaskNotFoundError`.
