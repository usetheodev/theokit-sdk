# D404 — Mattermost file uploads deferred to v0.2

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

v0.1 ships text-only. File uploads / attachments / slash-commands / ephemeral messages deferred.

## Rationale

Same 90/50 scope reasoning as D280 (Slack files).

## Consequences

Callers needing uploads use `adapter.getClient()` (escape hatch) on the underlying `@mattermost/client` Client4.
