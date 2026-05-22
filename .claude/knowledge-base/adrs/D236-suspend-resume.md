# D236 — Suspend/resume via `await ctx.suspend(payload?)` → `Workflow.resume({ runId, payload? })`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

A step.fn pauses the workflow by `await ctx.suspend(payload?)`, which throws a `WorkflowSuspendedSentinel`. The executor catches the sentinel, persists a snapshot, and returns `WorkflowRun` with `status: "suspended"`. Caller resumes with `Workflow.resume({ runId, workflow, payload? })`. The `suspend` standalone step kind (`kind: "suspend"`) also supports explicit pauses without an fn.

## Rationale

Mastra-validated pattern in production. Covers human-in-the-loop, external event waits, and retry-with-cooldown. Sentinel-based control flow keeps the API ergonomic without manual `return { suspend: true }` style.

## Consequences

- Engine serializes the accumulator state via JSON (D235); non-JSON values fail at suspend (EC-4 → `WorkflowNotSerializableError`).
- Resume requires the same workflow shape — `currentStepId` must exist in the workflow being resumed (EC-8 → `WorkflowResumeStepNotFoundError`).
- `payloadSchema` (optional Zod) validates resume payload before re-entering execution.
