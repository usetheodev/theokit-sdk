# D94 — `Agent.invalidateCache(reason, options?)` defaults to deferred

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D95, plan `agent-core-loop-completion-plan.md`

## Decision

The public `Agent.invalidateCache(reason, options?)` API:

- Default `options.applyNow: false` — records `invalidationPending` state;
  consumed at the start of the next `agent.send()` via `reload()`.
- `applyNow: true` — immediately disposes the agent (caller must re-create
  to continue).

## Rationale

Cache invalidation is a cost regression (provider charges full price for
the rebuilt cache; Hermes `AGENTS.md:840-851`). Default deferred preserves
cache discipline by:

1. Letting the in-flight send finish without disruption.
2. Applying refresh once, at the boundary between sends, so the next
   send sees the new state.

`applyNow: true` is the explicit opt-in for "I need this state visible
right now, bill me for the cache rebuild" — for example, after a slash-
command that adds a new skill the user wants in the very next turn.

## Consequences

- **Enables:** correct pattern for `/add-skill`, `/update-system-prompt`,
  and similar deferred-state operations.
- **Constrains:** callers who expect immediate effect must pass
  `applyNow: true`. Documented in `docs.md`.
