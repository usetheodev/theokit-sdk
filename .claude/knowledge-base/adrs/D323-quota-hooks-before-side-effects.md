# D323 — Quota hooks fire BEFORE any side effects

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 6, T6.2 + T6.3

## Decision

`onBeforeCreate` fires AFTER `validateAgentOptions` + `validateCloudToolParity` (input validation) but BEFORE:
- Registry insert (`registerAgent` / `registry.json` persist)
- LocalAgent constructor execution (MCP server boot, plugin load, hooks resolution)
- Live cache `Agent.registry.set`

`onBeforeSend` fires AFTER the cache invalidation check + model override but BEFORE:
- `runPreHook` (file-based hooks)
- `applyPreUserSendHook` (memory adapter recall)
- User message append to session storage
- LLM call

## Rationale

**Idempotency under rejection.** If a quota hook throws AFTER side effects (registry insert, storage write), the agent is half-created — registry has an entry but no live instance exists. The next `getOrCreate(id)` would return UnknownAgentError or, worse, find the orphan and resume incorrectly.

Order matters:
1. Input is well-formed? (validation)
2. Caller authorized? (quota hook)
3. Now perform side effects (registry / storage / LLM)

Match the standard "validate → authorize → execute" pipeline of HTTP middleware.

## Alternatives considered

- **Hook after registry insert + roll back on reject** — rejected. Compensation paths are bug-prone (registry persist is async; the rollback can race other registrations).
- **Hook BEFORE input validation** — rejected. Quota check on malformed input is wasted compute.

## Consequences

- Failed quota check leaves zero orphan state on disk or in memory.
- Hook implementer cannot use registry data that only exists post-create — but that's fine: quota is an input-side concern (count of agents per user) which the consumer's own DB tracks.
