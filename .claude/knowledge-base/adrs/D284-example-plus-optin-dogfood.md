# D284 — Example app + opt-in (env-gated) live integration test

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`examples/slack-bot/` standalone with one demo command (echo). README walks through: create Slack app, enable Socket Mode, generate tokens, set `.env`. Live test gated by `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` env vars — if absent, skip with clear message (no fail).

## Rationale

Mirror `examples/telegram-pro/`. Live test requires the developer's own Slack workspace; can't be mandatory CI. Skip-with-message > fail-masking-real-cause.

## Consequences

- README setup walkthrough.
- Tests env-gated.
- Documented as manual (vs. Telegram-pro's CDP automation).
