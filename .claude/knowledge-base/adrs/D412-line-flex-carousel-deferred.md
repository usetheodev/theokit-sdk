# D412 — LINE Flex Message + Carousel deferred to v0.2

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

v0.1 sends text only via `sendMessage()`. Rich types (Flex, Carousel, Quick Reply, Rich Menu) accessible via `adapter.getClient().pushMessage(...)` escape hatch.

## Rationale

Same justification as D281 (Slack Block Kit). Rich rendering is vertical-specific.

## Consequences

Callers needing rich messages go through the SDK directly.
