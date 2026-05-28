# D417 — Matrix MSC4140 threads deferred to v0.2

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

v0.1 does NOT implement Matrix threads. Replies always land at room root.

## Rationale

MSC4140 is still experimental; clients (Element) implement partially. Wait until spec stabilizes.

## Consequences

Documented limitation. Users replying to a thread will see the bot's reply at room root, not in-thread.
