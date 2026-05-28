# D395 — MMS (media attachments) deferred to v0.2

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

v0.1 ships text-only. Inbound MMS rejected with stderr warn; outbound text only.

## Rationale

MMS adds: media upload to CDN, MIME handling, transcoding. v0.1 delivers 90% value (text) with 50% effort. Same pattern as D280 (Slack file uploads) + D404 (Mattermost files).

## Consequences

Callers needing MMS use `adapter.getBackendClient()` escape hatch or wait for v0.2.
