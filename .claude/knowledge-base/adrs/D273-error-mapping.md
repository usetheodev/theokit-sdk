# D273 — Slack API error mapping to canonical `SendResult` codes

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`mapSlackError(err)` translates Slack error codes to gateway-canonical codes:
- `rate_limited` → `{ code: "rate_limit", message: <retry_after> }`
- `channel_not_found` → `{ code: "channel_not_found" }`
- `not_in_channel` / `missing_scope` → `{ code: "no_permission" }`
- `invalid_auth` / `token_revoked` / `account_inactive` → `{ code: "auth_error" }`
- `message_limit_exceeded` / `msg_too_long` → `{ code: "message_too_long" }`
- Others → `{ code: "platform_error", message: <code>: <msg> }`

## Rationale

Canonical codes consumed by `DeliveryRouter` (D175) for retry decisions. Slack has ~50 error codes; mapping the recurring ones keeps the API simple.

## Consequences

- 5+ mapping tests + fallback test.
- Documented in `docs.md`.
