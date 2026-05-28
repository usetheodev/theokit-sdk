# D391 — SMS phone numbers normalized to E.164 (libphonenumber-js)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

`normalizeE164(input, defaultCountry?)` parses with `libphonenumber-js` and returns canonical `+5511999999999` form. Throws `ConfigurationError({ code: "invalid_phone_number" })` on non-parseable input.

## Rationale

Without canonical form, the same person creates multiple sessions (`+5511 99999-9999` vs `+5511999999999`). `SessionRouter` cache hit-rate depends on stable key.

## Consequences

+130KB peer-dep. **EC-6** absorbed: US toll-free (`+18001234567`) requires `libphonenumber-js` full (not `/mobile` sub-bundle which rejects TOLL_FREE type).
