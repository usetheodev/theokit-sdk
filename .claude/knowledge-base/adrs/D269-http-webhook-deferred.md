# D269 — HTTP webhook transport deferred to v1.x

**Date:** 2026-05-22
**Status:** Accepted (slot reserved; engine deferred)

## Decision

`SlackAdapterOptions.transport?: "socket"` accepts only `"socket"` in v1. Adding `"http"` requires implementing Bolt `ExpressReceiver` / `HttpReceiver` + URL verification + signature check.

## Rationale

Foco em ship simples. Webhook requires: domain, TLS, Slack-side retry (3 attempts in 3 seconds), `signing_secret` rotation, `app_id` routing. v1.x adds when enterprise multi-tenant demand surfaces.

## Consequences

- Default = Socket Mode.
- v1 documents limitation.
- Forward-compat: type `transport: "socket" | "http"` already in shape.
