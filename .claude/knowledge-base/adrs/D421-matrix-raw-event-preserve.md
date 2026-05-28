# D421 — Matrix raw event preserved in `event.matrix.raw`

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

`MatrixMessageEvent.matrix.raw` exposes the full `MatrixEvent` from `matrix-js-sdk`. Caller accesses redactions, relations (m.replace edits, m.reaction), unsigned data, etc. via raw.

## Rationale

Matrix events are rich (replies, reactions, edits via `m.replace` relations). Normalizing every field would explode the surface; raw escape-hatch covers the long tail.

## Consequences

`event.text` + `event.sender` + `event.channel` always cover 80% of cases. Raw covers the rest.

**EC-3 absorbed (separately documented at file `sync.ts`):** initial sync drops events older than 60s (60-room bot × 10 events = 600 LLM calls otherwise). Implementation lives in `shouldDispatchSyncEvent`; raw events older than the window never reach the handler.
