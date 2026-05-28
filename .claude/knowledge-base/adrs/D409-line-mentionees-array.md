# D409 — LINE mentionees via metadata array (no inline `@text`)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

LINE webhook delivers mentions as `event.message.mentionees: [{ index, length, userId }]` — out-of-band from text. Adapter normalizes to `event.line.mentionees: string[]` (userIds only). Mention guard checks `botUserId in event.line.mentionees`.

## Rationale

Inconsistent with Telegram/Discord/Slack which use inline `@username` text. LINE API forces the separated representation.

## Consequences

`stripBotMention()` uses `mentionees[i].index + length` cuts, not regex. Group chats require `botUserId` opts; without it, the mention guard is disabled.
