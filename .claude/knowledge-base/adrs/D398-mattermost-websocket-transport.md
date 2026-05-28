# D398 — Mattermost inbound via WebSocket gateway

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Connect via `/api/v4/websocket` with access token. Inbound flows via `posted` event listener.

## Rationale

Outgoing webhooks are per-channel-specific. WebSocket covers all user-scope channels (DMs, mentions, channels the bot is in). Same trade-off as Slack Socket Mode vs Events API (D268).

## Consequences

Long-running connection; SDK auto-reconnect with backoff.
