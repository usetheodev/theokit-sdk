# D321 — Aborted runs surface as `AgentRunError({ code: "aborted" })`

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 4, T4.4 + T3.5

## Decision

When `AbortSignal` fires mid-stream and the loop's collector catches the `DOMException("AbortError")` from the underlying `fetch`, the run result carries `status: "error"` with an error shape that includes `code: "aborted"`. When `Agent.prompt({ throwOnError: true })` (or any helper using `run.wait`) translates RunResult.error into `AgentRunError`, the resulting throw has `code: "aborted"` (T3.5).

Callers can branch:

```ts
try {
  await Agent.prompt(message, { ..., throwOnError: true });
} catch (err) {
  if (err instanceof AgentRunError && err.code === "aborted") {
    // user cancelled — suppress UI noise
  }
}
```

## Rationale

Consistent error shape across the SDK. Without this, callers `catch (DOMException)` separately from `catch (AgentRunError)`, branching on `instanceof` chains. The mapper unifies — abort is always `AgentRunError({ code: "aborted", retriable: false })`.

`retriable: false` because retry on an explicit user cancel is semantically wrong. The user said stop.

## Alternatives considered

- **Leave the DOMException raw** — rejected. Forces consumers to maintain two error hierarchies. Bad ergonomics.
- **Make `aborted` retriable** — rejected. Aborts are intentional (user) or lifecycle (dispose) — neither benefits from retry.

## Consequences

- `err.cause` still carries the original DOMException for debugging.
- All examples documenting error handling can use a single `switch (err.code)` block including `"aborted"`.
