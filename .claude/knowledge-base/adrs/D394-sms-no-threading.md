# D394 — SMS has no threading model (phone = thread)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

`event.channel.type = "dm"` always; `topicId = undefined`. SessionRouter keys on `sender.id` (E.164).

## Rationale

SMS protocol has no threading. Inventing one is over-engineering.

## Consequences

US "MMS group" (multi-recipient) not supported in v0.1.
