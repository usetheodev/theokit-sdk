# Changelog

## [0.1.0] — 2026-05-20

### Added

- Initial release. `DiscordAdapter` wraps discord.js in the `@usetheo/gateway` `BasePlatformAdapter` contract.
- Default intents include `MessageContent` so `msg.content` is delivered (EC-C silent-failure guard).
- Bot-to-bot messages auto-ignored (`msg.author.bot === true`).
- WebSocket Gateway mode only (ADR D179).
