# Changelog

## [Unreleased]

### Added
- Initial package skeleton (Roadmap v1.4 #2).
- `WhatsAppAdapter` extending `BasePlatformAdapter` with multi-backend support (ADRs D303-D314).
- `WhatsAppCloudBackend` for Meta WhatsApp Business Cloud API (D304).
- `WhatsAppWebBackend` for `whatsapp-web.js` subprocess bridge (D305).
- `verifyWebhookSignature` + `verifyWebhookSubscription` helpers (D306, D312).
- `splitForWhatsApp` 4096-char message splitter (D310).
- `mapWhatsAppCloudError` + `mapWhatsAppWebError` per-backend error mappers.
- Group mention filter with digit-only normalizer (D309).
- Status receipts via `onStatusReceipt` callback (D307).
