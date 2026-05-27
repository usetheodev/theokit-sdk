# D370 — `CloudAgent` task ops throw `UnsupportedTaskOperationError`

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

Cloud runtime is pre-release (root `CLAUDE.md` 3.49/4.0). `runUntil` (D122), `usePersonality` (D169), `runWorkflow` (D244), and Bedrock Converse (D296) all already throw `UnsupportedRunOperationError` on `CloudAgent`. Task registry depends on in-process AbortController + AsyncSemaphore — neither has a cloud equivalent yet.

## Decision

Calling `CloudAgent.send(prompt, { task: true })` (or batch/workflow on cloud) throws `UnsupportedTaskOperationError extends TheokitAgentError` with `code: "task_op_unsupported"`.

## Rationale

- Consistency with the existing cloud-defer pattern.
- Explicit error is better than silent in-memory wrapping that the cloud cannot observe.
- v1.x extension when PaaS exposes a hosted task registry.

## Consequences

- Caller code-gating cloud usage receives a typed exception they can catch.
- v1 tasks are local-only.
- Docs explicitly note "Task observability is local-only in v1; cloud support pending PaaS GA."
