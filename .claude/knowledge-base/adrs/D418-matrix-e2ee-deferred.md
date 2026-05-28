# D418 — Matrix E2EE deferred to v0.2 (opt-out default)

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

v0.1 refuses to operate on E2EE rooms. Inbound from encrypted room → one-shot stderr warn per room id (`encrypted_room_unsupported`), no dispatch. Outbound `sendMessage` to encrypted room → `SendResult{ ok: false, error: { code: "encrypted_room_unsupported" } }`.

## Rationale

E2EE in Matrix requires key sharing, device verification, Olm/Megolm crypto — adds ~1MB lib + significant complexity. v0.1 delivers 90% (unencrypted rooms still dominate org/public traffic).

## Consequences

Callers needing E2EE: wait for v0.2 OR drive `matrix-js-sdk` directly via `adapter.getClient()`.
