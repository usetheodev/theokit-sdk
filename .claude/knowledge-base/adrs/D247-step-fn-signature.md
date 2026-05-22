# D247 — `step.fn` signature: `(input, ctx) => Promise<output>` where `ctx = { runId, signal, log, suspend }`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Step functions receive two parameters:
1. `input` — output of the prior step (typed via `inputSchema`/builder generic).
2. `ctx: StepContext` — utilities: `runId` (string for logging), `signal: AbortSignal`, `log: { debug, info, warn }`, `suspend: (payload?) => Promise<never>`.

Returns a `Promise<output>` (rejected promise = step error).

## Rationale

`ctx` separated from `input` keeps signatures clean. `log` is the SDK's redacted logger (D68-D73 redaction applied at output boundaries automatically). `suspend` as a method gives ergonomic suspend semantics — `await ctx.suspend(payload)` reads naturally and is type-safe because the return type is `never`.

## Consequences

- Mocking `ctx` in tests = pass a stub with `signal: new AbortController().signal`, `log: console`, etc.
- Adding fields to `StepContext` is non-breaking (additive).
- Step.fn that needs no `ctx` can ignore the second param: `(input) => ({ ok: true })`.
