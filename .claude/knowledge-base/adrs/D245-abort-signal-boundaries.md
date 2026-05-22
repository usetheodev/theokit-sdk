# D245 — Cancellation via `AbortSignal` at step boundaries + `ctx.signal` exposed to step.fn

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`.run(input, { signal })` injects the caller signal into the executor. Before each step dispatch, executor checks `signal.aborted` and throws `AbortError`. `StepContext.signal` is the combined (caller + flight) signal — step.fn can pass it through to `fetch`/`agent.send`. Retry-backoff sleeps are abortable mid-flight. EC-1: entry check is now mandatory.

## Rationale

`AbortSignal` is the canonical TS cancellation primitive (D117, D140). Boundary check guarantees abort doesn't corrupt mid-step state — step.fn is treated as atomic. Backoff sleep must abort because waiting through it when the user has cancelled is a UX killer.

## Consequences

- Step.fn that does HTTP fetch should pass `ctx.signal` to `fetch(url, { signal })`.
- Tests use fast-check signal aborts at random points to surface boundary bugs.
- `abortableSleep(ms, signal)` is the canonical helper for any `setTimeout`-style wait inside the workflow runtime.
