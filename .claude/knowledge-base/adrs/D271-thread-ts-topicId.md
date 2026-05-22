# D271 — Slack `thread_ts` is the canonical `topicId`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

When a message arrives in a thread (D270), `channel.topicId = event.thread_ts`. Outbound `OutboundMessage.channel.topicId` is passed as `thread_ts` to `chat.postMessage`.

## Rationale

Slack threading is more granular than Telegram (`message_thread_id` only in forums) and Discord (`channel.isThread()`); `thread_ts` is the thread anchor. 1:1 mapping keeps the gateway abstraction clean.

## Consequences

- Round-trip tests verify thread reply preserves `thread_ts`.
- Documented difference vs Telegram in `docs.md`.
