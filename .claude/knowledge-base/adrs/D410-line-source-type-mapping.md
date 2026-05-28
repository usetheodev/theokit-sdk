# D410 — LINE source-type mapping

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

LINE `source.type`: `user` → `"dm"`; `group`/`room` → `"group"`. No threads in v0.1. `event.line.sourceType` preserves the original.

## Rationale

Group vs Room (persistent vs ad-hoc multi-user) is functionally equivalent for the agent. Distinction available via raw if needed.

## Consequences

Caller branching `group` vs `room` reads `event.line.sourceType`.
