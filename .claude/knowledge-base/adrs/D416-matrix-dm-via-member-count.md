# D416 — Matrix DM detection via `memberCount === 2`

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

`room.getJoinedMemberCount() === 2` → `channel.type: "dm"`; else `"group"`.

## Rationale

Matrix has no native DM concept — DMs are 2-member rooms. Canonical heuristic.

## Consequences

False positive: user creates intended-as-small-group 2-person room → detected as DM. Caller can use `m.direct` account-data or `event.matrix.roomId` to override.
