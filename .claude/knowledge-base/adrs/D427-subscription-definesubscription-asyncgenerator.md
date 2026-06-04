# D427 — `defineSubscription` DSL uses Zod input/output + AsyncGenerator handler

- **Status:** Accepted
- **Date:** 2026-06-04
- **Plan:** `g8-streaming-websocket-sse-resume-plan`

## Decision

```ts
defineSubscription<TInput, TOutput>({
  input: ZodLike<TInput>,
  output: ZodLike<TOutput>,
  handler: (input: TInput, ctx: SubscriptionCtx) =>
    AsyncGenerator<TOutput | TrackedEnvelope<TOutput>, void, void>,
});
```

Validates `input` via `safeParse` BEFORE handler invocation. Handler yields plain `TOutput` frames OR `ctx.tracked(id, payload)` tracked envelopes.

## Rationale

AsyncGenerator pattern is locked by D116 (`Agent.runUntil`) + D232 (`Workflow.Step`). Reusing it for subscriptions keeps mental model coherent and composes naturally with `for await ... of`.

- **Promise-of-Observable** (RxJS-style, rejected): heavier surface; non-standard composition; needs interop layer.
- **Callback-based** (Socket.IO `on(event, cb)`, rejected): inconsistent with SDK's existing AsyncGenerator pattern.
- **Raw frames (no Zod)** (rejected): loses end-to-end typing that's the whole point of typed RPC.

## Consequences

Handler errors propagate naturally (throw → wire-format `error` frame). Cancellation via `ctx.signal.aborted` checks in long-running loops. Tracked envelopes give consumers full control over resume token semantics (D424).
