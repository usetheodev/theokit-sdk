# Changelog

## 2.0.0

### Patch Changes

- Updated dependencies
  - @usetheo/sdk@1.3.0
  - @usetheo/gateway@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - @usetheo/sdk@1.2.0
  - @usetheo/gateway@1.0.0

## [0.1.0] — 2026-05-20

### Added

- Initial release. `DiscordAdapter` wraps discord.js in the `@usetheo/gateway` `BasePlatformAdapter` contract.
- Default intents include `MessageContent` so `msg.content` is delivered (EC-C silent-failure guard).
- Bot-to-bot messages auto-ignored (`msg.author.bot === true`).
- WebSocket Gateway mode only (ADR D179).
