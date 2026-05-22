# D268 — Socket Mode is the only transport in v1 (no HTTP webhook)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`SlackAdapter` operates exclusively in Socket Mode in v1. Requires both `botToken` (xoxb-) and `appToken` (xapp- with `connections:write` scope).

## Rationale

Socket Mode is zero-infra (no public domain, TLS, load balancer). HTTP webhooks need URL verification challenge handling, Slack-side retry semantics, and signature verification — all defer to v1.x.

## Consequences

- Caller must enable Socket Mode in the Slack app admin UI.
- Setup walkthrough documented in `examples/slack-bot/README.md`.
- HTTP webhook explicitly deferred (D269).
