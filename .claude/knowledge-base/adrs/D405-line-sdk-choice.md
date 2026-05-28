# D405 — LINE SDK = `@line/bot-sdk@^9`

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Peer-dep `@line/bot-sdk@^9.0.0` (lazy). v9 exposes both legacy `Client` and modern `messagingApi.MessagingApiClient`; we accept either.

## Rationale

Official LINE Corp SDK. Maintained, typed, supports signature validation built-in.

## Consequences

Single peer-dep; both API surfaces (legacy + v9) work.
