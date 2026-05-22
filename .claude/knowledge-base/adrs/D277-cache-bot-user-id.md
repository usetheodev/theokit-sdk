# D277 — `botUserId` cached after `connect()` via `auth.test`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

In a successful `connect()`, `await app.client.auth.test()` returns `user_id`. Store in `this.botUserId`. Re-fetch only on reconnect.

## Rationale

`auth.test` is cheap and runs once on startup. Cache avoids per-event lookup (which would run thousands of times). Hermes-Agent + OpenClaw both follow this pattern.

## Consequences

- Invalid token fails `connect` (not later `sendMessage` — fail-fast).
- Tests mock `auth.test`.
- Documented.
