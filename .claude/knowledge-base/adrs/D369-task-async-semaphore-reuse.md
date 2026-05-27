# D369 — Concurrency control via existing `AsyncSemaphore` (D135)

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

`Agent.batch` already uses `AsyncSemaphore` (D135) — an in-house, audited primitive with 1600+ fast-check runs. Adding `p-limit` / `p-queue` as a peer would duplicate functionality.

## Decision

`TaskRegistry` uses `AsyncSemaphore` for concurrency throttling, default `maxConcurrent: 8`. Configurable via `Task.configure({ maxConcurrent })`.

## Rationale

- Zero new dependencies (consistent with D135).
- Same primitive is exercised by `Agent.batch` — production-proven.
- Default 8 mirrors `Agent.batch` default (D136), reducing surprise.

## Consequences

- Reentrant submit (work-fn calling `Task.submit`) requires special handling — see EC-11 ALS-based semaphore bypass.
- Caller wanting unlimited concurrency sets `Infinity`; no warning issued.
- Telemetry exposes `task.queue.depth` and `task.running.count` for monitoring.
