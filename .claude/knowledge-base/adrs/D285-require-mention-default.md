# D285 — `requireMention: true` default for channels (EC-3 absorbed)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`SlackAdapterOptions.requireMention?: boolean` (default `true`). When `true` and `channelType === "group"` from a public channel (`channel_type === "channel"`), `normalizeSlackEvent` discards messages that do NOT contain `<@${botUserId}>`. DMs and mpims (multi-DM) always pass — mention is implicit.

## Rationale

Slack delivers every channel message to the bot's event handler (unlike Telegram privacy mode / Discord MessageContent intent). Without a guard, a bot added to a public channel listens to everyone and tries to respond — cost explosion + spam. Safer default + explicit opt-out.

## Consequences

- Apps wanting the bot to respond to all channel messages (FAQ scraper, summarize-on-message bots) opt out: `requireMention: false`.
- Documented trade-off in `docs.md`.
- Tests cover both modes.
