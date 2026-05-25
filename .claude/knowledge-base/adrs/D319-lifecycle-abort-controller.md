# D319 — `LocalAgent` owns a `#lifecycleAbortController` composed with user signal

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 4, T4.2

## Decision

Each `LocalAgent` instance owns a private `lifecycleAbortController: AbortController`. `agent.dispose()` calls `lifecycleAbortController.abort()`. Every `send()` composes the lifecycle signal with the caller's `SendOptions.signal` via `anySignal` (D324) so either trigger cancels the in-flight LLM stream.

## Rationale

Two cancellation sources need to coexist:
- **User-triggered:** browser disconnect, `controller.abort()` from route handler
- **Lifecycle-triggered:** `agent.dispose()`, eviction from `Agent.registry` (D309), graceful SIGTERM via `evictAll`

Without composition, lifecycle-triggered aborts would not cancel in-flight LLM fetches — `dispose` would block on token completion. With composition, eviction reclaims memory promptly.

`anySignal` ponyfill (D324) handles runtimes without native `AbortSignal.any`.

## Alternatives considered

- **Listen to dispose, abort manually inside `send`** — rejected. Race-prone — `dispose` between signal-listen registration and the fetch call would miss the abort.
- **Use `AbortSignal.any` directly** — rejected for D324 reasons (runtime compat).

## Consequences

- `dispose()` aborts mid-stream sends — caller's `agent.send(...)` rejects with `AgentRunError({ code: "aborted" })` (D321).
- `Agent.registry.evict(id)` is fast — `dispose` doesn't await stream completion.
- `dispose` idempotent: second call's `abort()` is a no-op (AbortController spec).
