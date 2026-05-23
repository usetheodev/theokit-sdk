# D288 — `google-auth-library` is a required peer dep for Vertex

**Date:** 2026-05-23
**Status:** Accepted

## Decision

`google-auth-library` (~572KB) is a required peer dep of the Vertex profile. SDK calls `auth.getAccessToken()` per request (TTL 1h, refresh handled internally by the library).

## Rationale

No shortcut equivalent to `AWS_BEARER_TOKEN_BEDROCK` exists for Vertex — Google always requires OAuth 2.0 with refresh. `google-auth-library` resolves credentials via ADC (env → gcloud → metadata server → WIF). Reimplementing OAuth from scratch would be 200+ LoC and bug-prone.

## Consequences

- Callers who want Vertex install the peer dep. Error message (EC-3 absorbed) differentiates "module not found" from "no credentials" for clear DX.
- Repo `googleapis/google-auth-library-nodejs` is read-only since November 2025 but remains security-patched. Documented in README.
