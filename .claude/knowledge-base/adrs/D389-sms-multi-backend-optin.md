# D389 — SMS gateway is multi-backend opt-in (Twilio + Plivo + Vonage)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Context

SMS has no single dominant provider (unlike WhatsApp = Meta or Slack = Bolt). Twilio, Plivo, and Vonage cover ~95% of programmable SMS market.

## Decision

`@theokit/gateway-sms` exposes discriminated union `SMSBackendKind = "twilio" | "plivo" | "vonage"` selected via constructor option `backend`. Each backend SDK is an optional peer-dep; only the selected backend's SDK is imported lazily.

## Rationale

Same multi-backend pattern as `@theokit/gateway-whatsapp` (D303) which proved viable. Avoids forcing all three peer-deps on every consumer.

## Consequences

Slightly more upfront code (3 backends + factory). Consumers `pnpm add twilio` (or plivo/vonage) — only what they use.
