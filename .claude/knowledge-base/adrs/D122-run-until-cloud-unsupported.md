# D122 — `runUntil` and `fork` throw on CloudAgent

**Date:** 2026-05-19
**Status:** Accepted

## Decision

`CloudAgent.runUntil()` and `CloudAgent.fork()` both throw
`UnsupportedRunOperationError` **synchronously** (no AsyncGenerator
returned for `runUntil`). The `RunOperation` literal union gains two
new values: `"runUntil"`, `"fork"`.

## Rationale

Cloud runtime manages the goal loop server-side — exposing a per-turn
control surface would leak runtime internals across the wire. Fork
likewise requires local credential + system-prompt access for cache-hit
optimization (ADR D112); the cloud API doesn't surface those primitives.

Mirroring the existing `downloadArtifact` pattern (D5) — cloud-only and
local-only operations throw `UnsupportedRunOperationError` rather than
returning silently incorrect results.

## Consequences

- **Enables:** API consistency. Callers branch on `runtime` once at
  setup time rather than per-call.
- **Constrains:** cloud users who want autonomous loops must use a
  local agent OR wait for the future PaaS `runUntil` endpoint (post-GA).
  Throwing synchronously despite the `AsyncGenerator` return type is
  documented (EC-G) so `for await` callers know to wrap in try/catch.
