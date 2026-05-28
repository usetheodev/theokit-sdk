# D407 — LINE Reply token first, Push API fallback

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Inbound events carry a one-shot `replyToken` valid for 60s — using it via the Reply API is free unlimited. `ReplyTokenCache` (LRU 1000 entries, 60s TTL, one-shot consume) keyed by sender userId.

Outbound `sendMessage`:
1. `cache.take(userId)` → if token: `replyMessage(token, ...)`.
2. Else: `pushMessage(userId, ...)` + warn stderr.

Multipart: first part uses Reply (when available), subsequent parts use Push.

## Rationale

LINE Push API is metered ($$$ after free 500/month). Reply API is free unlimited. Auto-switching saves real money.

## Consequences

In a long conversation, only the first response per inbound event is free. Caller plans accordingly.
