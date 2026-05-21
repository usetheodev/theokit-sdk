# Changelog

## [0.1.0] — 2026-05-20

### Added

- Initial release. `TelegramAdapter` wraps grammy in the `@usetheo/gateway` `BasePlatformAdapter` contract.
- `shouldRespondInChat(ctx, policy)` helper for group-chat filtering.
- `splitForTelegram(text)` helper for auto-splitting >4096-char messages.
- EC-I: invalid token resolves `connect()` to `false` (never throws).
- EC-J: `splitForTelegram` preserves markdown pair integrity.
- EC-K: ignores messages where `ctx.from.is_bot === true`.
