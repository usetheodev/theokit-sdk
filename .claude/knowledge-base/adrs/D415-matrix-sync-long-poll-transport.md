# D415 — Matrix transport = sync long-poll

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

`client.startClient({ initialSyncLimit: 10 })` triggers long-poll sync. Inbound surface via `Room.timeline` listener.

## Rationale

How Matrix works natively. No WebSocket equivalent (MSC4140 push notifications is separate).

## Consequences

Always 1 connection open per adapter. SDK handles auto-reconnect.
