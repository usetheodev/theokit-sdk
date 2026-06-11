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

## [Unreleased]

### Added — `@theokit/gateway-line@0.1.0` (ADRs D405-D412)

- Initial release of the LINE Messaging API adapter for `@theokit/gateway`.
- `@line/bot-sdk@^9.0.0` peer-dep (lazy import + signature support).
- Webhook-only transport (D406) — `createWebhookServer({ adapter, path, port })` with raw-body capture, HMAC-SHA256 signature middleware (D408), and 401 BEFORE handler dispatch.
- LineAdapter extends BasePlatformAdapter:
  - `connect()` validates channel secret + channel access token (D414 mirror).
  - `sendMessage()` uses **reply token first**, falls back to push API after token expiry (D407). Per-userId LRU cache (1000 entries, 60s TTL, one-shot consume).
  - `splitForLine()` 5000-char surrogate-safe split (D411, EC-7 pattern).
  - `onInbound()` replace semantics (EC-H).
- Mentionee handling (D409, EC-2 absorbed): `event.message.mentionees[]` extracted to `event.line.mentionees` (userId list, never inline `@text` confusion).
- Source-type mapping (D410): `user` → `dm`, `group`/`room` → `group`. No threads in v0.1.
- EC-4 absorbed: webhook delivers 9 event types (`message`, `follow`, `unfollow`, `join`, `leave`, `postback`, `beacon`, `accountLink`, `things`). `normalize.ts` filters `event.type !== "message"` AND `event.message.type !== "text"` at the top — no TypeErrors on non-text events.
- Signature middleware uses `crypto.timingSafeEqual` (D408).
- Flex Message + Carousel deferred to v0.2 (D412) — caller can drive via `adapter.getClient().pushMessage(...)` escape hatch.
