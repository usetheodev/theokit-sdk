# D366 — `TaskEvent` is a discriminated union by `type`

- **Status:** Accepted
- **Date:** 2026-05-27
- **Plan:** `tasks-queued-running-observable-plan` (Phase 0)

## Context

`SDKMessage` (Run events), `GoalEvent` (runUntil), and Workflow telemetry already use discriminated unions for event types. Each new event arm becomes a compile-time error when handlers don't account for it.

## Decision

```ts
type TaskEvent =
  | { type: "submitted"; ... }
  | { type: "started"; ... }
  | { type: "progress"; payload: unknown; ... }
  | { type: "finished"; result: unknown; ... }
  | { type: "errored"; error: { code: string; message: string }; ... }
  | { type: "cancelled"; reason?: string; ... };
```

Exhaustive `switch` enforced via `default: const _: never = msg; throw new Error(...)` guard.

## Rationale

- Type-safety: adding a 7th event arm requires updating every consumer.
- Subscriber callbacks receive structurally-typed events; no `instanceof` checks.
- JSON-serializable for persistence in store + telemetry export.

## Consequences

- 6 event types fixed for v1; extending requires major version bump.
- `progress.payload` is `unknown` — callers must validate or cast.
- Mirrors D115 (GoalEvent).
