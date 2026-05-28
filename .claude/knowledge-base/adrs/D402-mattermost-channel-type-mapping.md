# D402 — Mattermost channel-type mapping

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Map Mattermost channel `type`: `D` → `"dm"`, `G`/`O`/`P` → `"group"`. Original raw type preserved at `event.mattermost.channelType`.

## Rationale

`MessageEvent` core knows only `dm | group | thread`. Public vs private channel distinction goes through the escape hatch.

## Consequences

Callers needing public/private distinction read `event.mattermost.channelType`.
