# D312 — `retryAfterMs` is a computed getter over `metadata.retryAfter` (seconds)

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 3, T3.2

## Decision

`AgentRunError.retryAfterMs` is a `get` accessor that returns `this.metadata?.retryAfter * 1000` (or `undefined` when no metadata). The underlying `metadata.retryAfter` continues to be the seconds value as parsed by provider mappers per D67.

## Rationale

Mappers (`internal/errors/mappers/shared.ts`) parse `Retry-After` HTTP header as seconds (RFC 9110). Renaming `metadata.retryAfter` to `metadata.retryAfterMs` would force a touch on all 5 mappers + their tests, breaking D67's stability.

Adding a getter is zero-cost: `setTimeout` and `Date.now()` both expect milliseconds, so consumers branching on `err.retryAfterMs` directly multiplies without manual conversion.

EC-11 absorbed: `metadata.retryAfter === 0` returns `0` (not undefined). Caller must use `=== undefined` check, not truthy check. Documented in docs.md.

## Alternatives considered

- **Rename `metadata.retryAfter` → `retryAfterMs`** — rejected. Touches mappers + tests. Not a strict improvement over a free getter.
- **Add both `retryAfter` and `retryAfterMs` to constructor** — rejected. Duplicates source of truth. The getter is single-source-of-truth derived.

## Consequences

- Consumers get ergonomic milliseconds.
- The seconds-based `metadata.retryAfter` still exposed for callers that want to display "wait 30s".
