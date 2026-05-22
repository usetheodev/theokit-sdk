# D242 — Single-flight per `(workflowId, runId)` — throws `WorkflowAlreadyRunningError` on collision

**Date:** 2026-05-22
**Status:** Accepted

## Decision

A module-level `Map<string, AbortController>` tracks in-flight workflow runs. Key = `${workflowId}:${runId}` where `workflowId` is minted at `.commit()` time (EC-5). Acquire on `.run()` / `.resume()`; release in `finally`. Duplicate runs throw `WorkflowAlreadyRunningError`.

## Rationale

Same guarantee as `Eval` D213. Two concurrent runs with the same `runId` always indicate a bug (idempotency violation). Failing loudly is safer than silent race conditions. Using `workflowId` (not `name`) in the key avoids false-positives when two `Workflow` instances share a name (EC-5).

## Consequences

- Lock is in-memory; process crash automatically releases.
- Tests follow `eval/single-flight.test.ts` pattern.
- Cross-process locking is out of scope (in-memory only) — multi-host orchestration is a v1.x concern.
