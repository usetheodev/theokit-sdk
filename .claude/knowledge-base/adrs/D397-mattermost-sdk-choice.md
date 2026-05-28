# D397 — Mattermost SDK = `@mattermost/client@^9`

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Peer-dep `@mattermost/client@^9.0.0` (lazy). NOT deprecated `mattermost-redux`.

## Rationale

`@mattermost/client` is the modern v4 REST + WebSocket SDK that the webapp uses. TS types native.

## Consequences

Works with self-hosted Mattermost (any baseUrl) and Mattermost Cloud.
