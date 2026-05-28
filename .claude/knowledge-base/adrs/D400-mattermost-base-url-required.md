# D400 — Mattermost baseUrl is required (self-hosted-first)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Constructor requires `opts.baseUrl` non-empty (e.g. `https://mattermost.acme.com`). No default.

## Rationale

Mattermost is self-hosted majority. Each install has its own domain. Forcing explicit configuration avoids the smell of "Cloud default".

## Consequences

Caller looks up their server URL once and configures.
