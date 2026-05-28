# D414 — Matrix auth = homeserver URL + access token + user id

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Constructor requires:
- `homeserverUrl` (e.g. `https://matrix.org`).
- `accessToken` (e.g. `syt_xxx`, generated via Element web UI → Settings → Help & About → Advanced).
- `userId` (full Matrix id like `@bot:matrix.org`, must start with `@`).

No interactive login flow.

## Rationale

Access token = canonic bot auth. Device login interactive flow doesn't fit. Federation means homeserver can be any (matrix.org, element.io, self-hosted).

## Consequences

Token compromise = full account access. Document secrecy.
