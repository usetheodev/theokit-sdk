# D373 — Auto-eviction of terminal tasks (1h InMemory, 7d JsonFile defaults)

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

Without eviction, the registry grows unbounded — a long-running process with frequent submits leaks memory (InMemory) or disk (JsonFile). Without retention, debugging recent failures becomes impossible because state was purged immediately.

## Decision

- InMemoryTaskStore: default `retentionMs = 60 * 60 * 1000` (1 hour).
- JsonFileTaskStore: default `retentionMs = 7 * 24 * 60 * 60 * 1000` (7 days).
- Timer in `TaskRegistry` runs `store.evictTerminalOlderThan(now - retentionMs)` every 5 minutes.
- Override via `Task.configure({ retentionMs })` OR per-job for Cron (`Cron.register({ task: { retentionMs } })`).

## Rationale

- 1h in memory covers interactive debugging without bloating long-running processes.
- 7d on disk covers post-mortem of overnight/weekend issues.
- Eviction interval 5min is a tradeoff between freshness and timer overhead.

## Consequences

- Terminal tasks visible until `finishedAt + retentionMs`.
- Resubmit with same ID after eviction creates a new run (D367 single-flight only applies while existing handle is present).
- High-frequency Cron jobs (EC-16) require per-job retention override.
