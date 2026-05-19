# D118 — Goal control via instance-level AbortController, not global helpers

**Date:** 2026-05-19
**Status:** Accepted

## Decision

Goal cancellation in v1.3 is exclusively via the caller-supplied
`AbortSignal` in `GoalOptions.signal`. The SDK does NOT expose
`agent.pauseGoal()` or `agent.clearGoal()` as instance methods.

If a future iteration needs per-agent goal state (e.g., a UI button
"pause this agent's current goal"), the caller stores the controller
externally:

```typescript
const controller = new AbortController();
const pauseGoal = () => controller.abort();
for await (const e of agent.runUntil(g, { signal: controller.signal })) { ... }
```

## Rationale

A `pauseGoal()` instance method would require per-agent state inside
`LocalAgent` to track "active goals". With concurrent goals (multiple
`runUntil` per agent), the API has to track them by id — explicit
controller passes through that ID naturally via JS lexical scoping.

KISS applies: AbortController is already in the platform; the SDK
doesn't need to invent a parallel pause API. The plan v1.0 listed
`pauseGoal`/`clearGoal` as instance methods, but during implementation
this evolved to the simpler controller-only pattern.

## Consequences

- **Enables:** N concurrent `runUntil` calls per agent, each with its
  own controller. Pause one without affecting others.
- **Constrains:** callers must manage the controller themselves. JSDoc
  on `runUntil` demonstrates the pattern.
