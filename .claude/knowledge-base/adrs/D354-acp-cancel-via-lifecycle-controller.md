# D354 — ACP `cancel` reuses LocalAgent lifecycle AbortController

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

ACP `cancel` notification interrupts an in-flight prompt. Our SDK has `LocalAgent.lifecycleAbortController` (D319) that fires on `dispose()` and composes via `anySignal` with caller-supplied signals.

## Decision

Each ACP session owns its own `AbortController`. `handleCancel(sessionId)` fires `session.abortController.abort("cancelled by ACP client")`. The signal is passed to `agent.send(text, { signal })`, propagating through to `fetch()`.

## Rationale

Reuse over parallel cancellation mechanism. Existing semantics from D318-D321 already produce `AgentRunError({ code: "aborted" })` on abort, which translator maps to ACP `stop_reason: "cancelled"`.

## Consequences

- Cancel is idempotent (calling twice is safe — AbortController.abort is idempotent).
- Cancel of unknown sessionId is a no-op (ACP spec friendly).
- Aborted runs do NOT persist partial assistant messages (D320 invariant preserved).
