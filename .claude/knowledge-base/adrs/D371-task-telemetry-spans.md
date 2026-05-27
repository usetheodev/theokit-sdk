# D371 — 3 OTel spans: `task.submit`, `task.transition`, `task.cancel`

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

The SDK already has a Telemetry seam (D34) with safe() wrapper that fails-open when OTel peer dependencies are absent. Workflow (D241) and Cache (D262) already use this seam.

## Decision

`TaskRegistry` emits 3 spans via the existing Telemetry seam:
- `task.submit` — span starts on submit, ends after handle inserted. Attrs: `task.id`, `task.kind`.
- `task.transition` — short-lived span per state transition. Attrs: `task.id`, `task.state.from`, `task.state.to`.
- `task.cancel` — span on cancel call. Attrs: `task.id`, `task.cancel.reason`, `task.cancel.via` (`api` | `cancelRequested`).

## Rationale

- Reuses D34 — no new tracer, no new peer.
- Adapters Langfuse/Sentry/PostHog (D42) consume spans without configuration changes.
- Minimal cardinality: 3 spans cover full task lifecycle.

## Consequences

- Without OTel installed, spans are no-ops (D34 safe-noop).
- Caller wanting per-progress-event observability builds their own subscriber over `Task.subscribe`.
- Span lifetimes are short — no nested spans for long-running tasks.
