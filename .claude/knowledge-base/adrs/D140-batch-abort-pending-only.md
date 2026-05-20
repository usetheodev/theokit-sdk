# D140 — `AbortSignal` cancels pending prompts only; in-flight ones complete

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`BatchOptions.signal: AbortSignal` follows standard Node semantics:
- **Pending** prompts (not yet acquired by the semaphore) → return
  `{ ok: false, error: TheokitAgentError(code: "aborted") }`.
- **In-flight** prompts (LLM HTTP call active) → continue to completion
  and resolve normally.
- **Pre-aborted** signal (EC-C) → every prompt resolves as
  `{ ok: false, error }` immediately.
- `signal.reason` propagation (EC-D) → when `signal.reason` is an
  Error, it propagates verbatim into `BatchResult.error.message` /
  `cause`. Otherwise a generic "Batch aborted via AbortSignal" error
  is used.

Hard timeout requires `Promise.race(batch, timeout)` from the caller.
We do NOT attempt to abort in-flight HTTP because cancelling mid-stream
corrupts the response and confuses retry logic (the same constraint
that drove the ADR for `FallbackLlmClient`).

## Rationale

Standard Node `AbortSignal` semantics are well-understood by every TS
developer. Diverging would create surprise: a caller wiring
`AbortController` from another library (e.g., a tRPC procedure
cancellation) expects the same behavior here.

Cancelling in-flight HTTP would also race with `agent.dispose()` and
the credential-pool cooldown logic — both depend on the HTTP request
running to completion (success or 4xx/5xx). Partial cancellation
would leak resources.

## Consequences

- **Enables:** observable abortion via standard primitive; integrates
  with every framework that produces AbortSignals (Fetch, tRPC,
  Hono, Next.js Server Actions, …).
- **Constrains:** caller cannot stop in-flight LLM requests mid-stream.
  Documented in JSDoc; for hard timeout, the caller wraps the batch
  in `Promise.race(batch, sleep(N).then(() => controller.abort()))`.
