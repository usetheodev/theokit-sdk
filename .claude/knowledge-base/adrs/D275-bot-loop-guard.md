# D275 — Bot loop guard: filter `event.user === botUserId` OR `bot_id` matching self

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`connect()` resolves `botUserId` via `auth.test`. Every inbound message passes through `normalizeSlackEvent` which discards events where `event.user === botUserId`. Events with `subtype: "bot_message"` and matching `bot_id` are also discarded.

## Rationale

Slack redelivers bot-authored messages to the bot's own event handler when other users are in the channel (own-view). Without filter, infinite echo loop. Hermes-Agent validated this pattern in production.

## Consequences

- `connect()` adds one `auth.test` API call (cheap, runs once).
- Tests cover bot-self-message filter + bot_id subtype.
