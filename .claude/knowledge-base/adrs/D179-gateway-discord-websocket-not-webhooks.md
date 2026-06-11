# D179 — Discord adapter uses WebSocket Gateway (discord.js), not HTTP webhooks

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`@theokit/gateway-discord` opens a long-lived WebSocket via discord.js's `Client.login()`. The v0.1 release does NOT ship a webhook-based variant.

## Rationale

WebSocket is the canonical Discord bot mode; webhook bots are limited (no presence, no DM, no thread events). Telegram's bot mode is long-polling (grammy default). Both are long-lived process patterns, justifying a unified "GatewayRunner stays up" lifecycle. v0.1 is not trying to be serverless-friendly.

## Consequences

- **Enables:** full Discord feature parity (slash commands via Application Commands, threads, reactions, presence) accessible to future iterations.
- **Constrains:** the gateway requires a long-lived process. Serverless deployment is out of scope. Documented; non-issue for VPS/Docker/local-dev.
