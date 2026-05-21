# D171 — Each platform adapter is its own peer-dep package

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`@usetheo/gateway-telegram` and `@usetheo/gateway-discord` are separate workspace packages, each declaring `@usetheo/gateway`, `@usetheo/sdk`, and the platform SDK (grammy / discord.js) as peer deps.

## Rationale

Exactly mirrors `@usetheo/memory-*` (D143). A consumer who only wants Telegram should not pay the install cost of discord.js (~1MB) and vice versa. Peer deps avoid the bundler-confusion problem when multiple adapters coexist.

## Consequences

- **Enables:** zero-cost addition of future adapters (Slack, WhatsApp, Signal) without modifying the core.
- **Constrains:** install instructions become more verbose. Mitigated by README examples in each package.
