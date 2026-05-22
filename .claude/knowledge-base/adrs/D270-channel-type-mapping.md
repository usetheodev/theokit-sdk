# D270 — Channel type mapping: `im → dm`, `mpim|channel → group`, `thread_ts present → thread`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Canonical `channel.type` derived from the Slack event:
- `channel_type === "im"` → `"dm"`.
- `channel_type === "mpim"` (multi-user DM) OR `"channel"` → `"group"`.
- Independent of above: if `event.thread_ts !== undefined && event.thread_ts !== event.ts`, then `channel.type = "thread"` and `channel.topicId = thread_ts`.

## Rationale

Maintains parity with Telegram (forum threads) and Discord (channel threads). `thread_ts` is Slack's canonical thread anchor — derived from Bolt docs.

## Consequences

- Tests cover 4 scenarios: DM, channel, mpim, thread reply.
- `mpim` and `channel` both map to `"group"` because the adapter consumer only needs to distinguish DM vs. shared context.
