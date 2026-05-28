# D406 — LINE inbound is webhook-only (no WebSocket)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

`createWebhookServer({ adapter, path, port, app? })` Express helper. No WebSocket option.

## Rationale

LINE Messaging API has no WebSocket gateway. Webhook is the only official path.

## Consequences

Caller exposes public URL (ngrok in dev).
