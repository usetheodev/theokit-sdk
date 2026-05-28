# D390 — SMS two-way via shared webhook server

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

`createWebhookServer({ adapter, path, port, app? })` Express helper registers per-backend routes (`/sms/twilio`, `/sms/plivo`, `/sms/vonage`). Caller can inject existing Express app or let helper create one.

## Rationale

SMS is inherently webhook-based (carriers POST inbound). Per-backend route lets each backend have its own parser middleware + signature verification while sharing the lifecycle (start/stop) and adapter dispatch.

## Consequences

Public port required (ngrok in dev). Caller controls lifecycle.
