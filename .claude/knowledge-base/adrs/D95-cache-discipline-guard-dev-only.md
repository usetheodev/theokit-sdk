# D95 — Cache-discipline guard runs only in dev mode

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D94, plan `agent-core-loop-completion-plan.md`

## Decision

`assertSystemPromptStable`, `assertToolsetStable`, `assertAppendOnly` (in
`internal/cache-discipline-guard.ts`) check `shouldGuard()` early:

```typescript
function shouldGuard(): boolean {
  return process.env.NODE_ENV !== "production";
}
```

Production: zero overhead — first line returns false, function exits
without comparison work.

Dev: stderr warn (NOT throw) when a stability invariant is violated.

EC-1 fix: `shouldGuard` is a function (not a module-init constant) so
vitest `vi.stubEnv("NODE_ENV", "production")` can flip behavior mid-test.

## Rationale

Production hot path cannot pay JSON.stringify(tools) on every send. Dev/
test environments pay the overhead in exchange for fast feedback on cache-
discipline regressions.

Warn (not throw) is intentional: a cache invalidation is a cost regression,
not a correctness bug. Throwing would break workflows that intentionally
invalidate cache; the operator decides.

## Consequences

- **Enables:** CI catches regressions (CI runs with `NODE_ENV !== production`).
  Operators see stderr messages and decide.
- **Constrains:** prod-only bugs in cache discipline only surface via
  metrics (cache hit rate, cost). Documented as known limit.
