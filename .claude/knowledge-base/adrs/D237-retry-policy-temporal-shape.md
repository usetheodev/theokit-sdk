# D237 — Retry policy is declarative per step, Temporal-shape: `retry: { maxAttempts, initialBackoffMs, backoffCoefficient, nonRetryableErrors? }`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`FnStep` and `AgentStep` accept an optional `retry: RetryPolicy` field. Defaults: `maxAttempts: 1` (no retry), `initialBackoffMs: 1000`, `backoffCoefficient: 2.0`, `maximumBackoffMs: 30_000`, `nonRetryableErrors: ["AbortError", "WorkflowSnapshotNotFoundError", "ConfigurationError"]`. Zod schema enforces `maxAttempts >= 1` and `<= 20` (EC-3).

## Rationale

Temporal validated this shape in production at scale. More expressive than Mastra (which delegates retry to its runner). Non-retryable error list prevents loops on logical errors (e.g., bad config, user abort).

## Consequences

- Retry attempts emit separate spans `workflow.step.<id>` with `step.attempt: N`.
- Cancellation via `AbortSignal` aborts mid-backoff sleep (does not wait for it).
- Idempotency is caller's responsibility — `step.fn` must tolerate being invoked multiple times.
- Default of `maxAttempts: 1` means "no retry"; users must opt in explicitly.
