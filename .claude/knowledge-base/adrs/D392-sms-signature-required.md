# D392 — SMS webhook signature is required (no insecure mode)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Each backend validates signature on inbound BEFORE handler dispatch. Twilio: `X-Twilio-Signature` HMAC-SHA1 (via SDK `validateRequest`). Plivo: `X-Plivo-Signature-V3` HMAC-SHA256. Vonage: `Authorization: Bearer <JWT>`. Rejection returns 401.

**EC-1 absorbed:** constructor refuses empty signing secret — `ConfigurationError({ code: "signing_secret_required" })`. No "opt-in insecure mode".

## Rationale

Webhook public endpoint without HMAC = spoofing trivial. Refusing at construction means insecure deployments cannot happen by accident.

## Consequences

Caller MUST provide signing secret. No "test mode" shortcut.
