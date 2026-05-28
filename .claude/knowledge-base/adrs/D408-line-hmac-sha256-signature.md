# D408 — LINE webhook signature HMAC-SHA256 (timingSafeEqual)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Verify `X-Line-Signature` header using `crypto.createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64")`. Compare via `crypto.timingSafeEqual`. Rejection returns 401 before dispatch.

Constructor refuses empty `channelSecret` with `ConfigurationError({ code: "channel_secret_required" })`.

## Rationale

Same defensive posture as SMS (D392). Webhook public = signature obligatory. Timing-safe compare prevents side-channel attacks.

## Consequences

No insecure mode. Caller MUST provide channel secret.
