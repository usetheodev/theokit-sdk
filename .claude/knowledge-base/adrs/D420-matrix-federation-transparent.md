# D420 — Matrix federation is transparent (SDK-handled)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Adapter does NOT special-case federation. `matrix-js-sdk` handles cross-homeserver routing automatically.

## Rationale

This is the point of Matrix. Bot at `@bot:matrix.org` can be added to rooms by users on any homeserver and the protocol routes events.

## Consequences

Performance varies by remote homeserver latency. Federation failures surface as standard `SendResult{ send_failed }`.
