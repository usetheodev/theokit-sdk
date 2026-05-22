# D274 — `SlackMessageEvent` extends `BaseMessageEvent` + `.slack.raw` = Bolt body

**Date:** 2026-05-22
**Status:** Accepted

## Decision

New interface `SlackMessageEvent` discriminated by `platform: "slack"`. Mirrors Telegram/Discord shape with `.slack.{teamId, channelId, userId, ts, threadTs?, subtype?, raw}`.

## Rationale

Discriminated union pattern (D173). `raw` exposed as `unknown` (D180 escape hatch) — caller narrows if Slack-specific fields are needed.

## Consequences

- New variant added to `MessageEvent` union.
- Discriminator `platform: "slack"` enables type narrowing in caller code.
- Tests cover normalization end-to-end.
