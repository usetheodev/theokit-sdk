# D115 — `GoalEvent` is a discriminated union by `type` field

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`GoalEvent` has five variants discriminated by `type`:
- `turn_start` — `{ type, turn, goal }`
- `agent_response` — `{ type, turn, content }`
- `judge_verdict` — `{ type, turn, verdict, reason, parseFailed }`
- `continuation` — `{ type, turn, prompt }`
- `status_change` — `{ type, status, reason }`

Consumers `switch (event.type)` with TypeScript exhaustiveness check.

## Rationale

Same rationale as `StreamObjectEvent` (ADR D39 already established): a
generic `{ type: string; data: unknown }` event forces every consumer to
write `if (event.type === "foo") { ...event.data as Foo... }`, losing
type-narrowing and exhaustiveness benefits. A discriminated union is
zero-cost at runtime and type-safe at compile time.

## Consequences

- **Enables:** `switch (event.type)` with TS exhaustiveness check.
  Forgetting a case is a compile error.
- **Constrains:** adding a sixth variant is a TS-visible breaking change
  for downstream consumers that exhaustively handle every type. By
  design — silent extensions cause silent bugs.
