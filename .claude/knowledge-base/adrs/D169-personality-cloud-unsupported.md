# D169 — `CloudAgent.usePersonality` throws `UnsupportedRunOperationError` (pre-release)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`CloudAgent.usePersonality()` returns a rejected promise carrying
`UnsupportedRunOperationError("Agent.usePersonality() is not supported
on cloud agents (pre-release). Use a local agent or wait for cloud GA.",
"usePersonality")`. The cloud runtime does not yet provide a stable
server-side enforcement path for personality resolution.

## Rationale

Mirrors the D122 pattern already used for `Agent.runUntil()` and
`Agent.fork()` on cloud — surface the limitation explicitly instead of
silently dropping the call or storing client-side state the server
would ignore. Cloud is pre-release; consistency between local and
cloud semantics is the bar before we lift this restriction.

## Consequences

- **Enables:** unambiguous error — callers branch on cloud vs local
  by feature presence (`agent.usePersonality?.(...)` returns rejection
  when on cloud).
- **Constrains:** lifting this requires the cloud runtime to ship
  server-side preset resolution that matches the local contract
  (D160-D168), then a removal PR.
