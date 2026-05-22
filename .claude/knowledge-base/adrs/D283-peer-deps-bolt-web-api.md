# D283 — Peer dependency on `@slack/bolt` + `@slack/web-api` (mirrors D171)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`gateway-slack/package.json` declares `@slack/bolt: "^3.20.0"` and `@slack/web-api: "^6.12.0"` as peer dependencies. Caller installs. Workspace deps: `@usetheo/gateway` + `@usetheo/sdk`.

## Rationale

Matches Telegram (grammy peer-dep) and Discord (discord.js peer-dep). Caller controls Slack SDK version (forward-compat with Bolt v4 when released).

## Consequences

- README documents install command.
- Tests use workspace install.
