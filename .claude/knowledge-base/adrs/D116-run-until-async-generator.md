# D116 — `Agent.runUntil` returns `AsyncGenerator<GoalEvent, GoalResult, void>`

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`Agent.runUntil(goal, options?)` returns
`AsyncGenerator<GoalEvent, GoalResult, void>`, not `AsyncIterable<GoalEvent>`.

Consumers have two consumption styles:
- `for await (const event of agent.runUntil(...))` — discards the return
  value, consumes events only
- `const gen = agent.runUntil(...); while ((r = await gen.next()).done === false)
  ...; const result = r.value;` — captures both events and the final
  `GoalResult`

## Rationale

`AsyncGenerator<TYield, TReturn>` is the right TS type for "stream events
PLUS a final value". `AsyncIterable<GoalEvent>` would force callers to
infer the result from the last event's `status_change`, which loses
type safety on `turnsUsed` and `finalResponse`. Python's `goals.py`
yields events and returns a `GoalResult` summary — same shape.

## Consequences

- **Enables:** dual usage pattern; `for-await` callers and manual
  `gen.next()` callers both supported.
- **Constrains:** `for-await` syntactically can't read the return value
  — TypeScript limitation. JSDoc documents the manual pattern for
  callers who need both.
