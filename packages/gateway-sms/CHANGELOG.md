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

### Added — `@theokit/gateway-sms@0.1.0` (ADRs D389-D396)

- Initial release of the SMS platform adapter for `@theokit/gateway`.
- Multi-backend opt-in: Twilio + Plivo + Vonage (D389). Each peer-dep is optional; install only what you use.
- `SMSAdapter` extending `BasePlatformAdapter` with:
  - `connect()` / `disconnect()` lifecycle (idempotent)
  - `sendMessage()` outbound with multipart `(i/N)` segmentation up to 1600 chars per part (D393), Intl.Segmenter surrogate-safe
  - `onInbound()` subscription (single-handler replace semantics — EC-H)
- `createWebhookServer()` Express helper with per-backend routes (`/sms/twilio`, `/sms/plivo`, `/sms/vonage`) and per-backend HMAC signature validation (D392) — rejects with 401 BEFORE handler dispatch.
- Constructor enforces signing secret (EC-1 absorbed): missing `authToken` throws `ConfigurationError` at construction time, never permits unsigned mode.
- `normalizeE164(input, defaultCountry?)` strict phone normalization via `libphonenumber-js` (D391). Accepts mobile + toll-free US numbers (EC-6).
- `splitForSMS(text, limit=1600)` UTF-16 / grapheme-cluster safe segmentation (EC-7).
- Tracks `SMSInbound` → `SMSMessageEvent` normalization with E.164 enforcement.
- No threading model: SMS conversations are flat per phone-pair (D394). `channel.type` always `"dm"`.
- MMS, group SMS, and budget-charge-per-message are deferred to v0.2 (D395, D396).
