# Changelog

## 2.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.3.0
  - @theokit/gateway@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.2.0
  - @theokit/gateway@1.0.0

## [0.1.0] — 2026-05-20

### Added

- Initial release. `TelegramAdapter` wraps grammy in the `@theokit/gateway` `BasePlatformAdapter` contract.
- `shouldRespondInChat(ctx, policy)` helper for group-chat filtering.
- `splitForTelegram(text)` helper for auto-splitting >4096-char messages.
- EC-I: invalid token resolves `connect()` to `false` (never throws).
- EC-J: `splitForTelegram` preserves markdown pair integrity.
- EC-K: ignores messages where `ctx.from.is_bot === true`.
