# D298 — SigV4 transport deferred to v1.x

**Date:** 2026-05-23
**Status:** Accepted

## Decision

v1 implements only Bearer auth (D286). Native SigV4 via `aws4` or similar is deferred.

## Rationale

Bearer GA covers ~80% of use cases. SigV4 requires a structured credential format (access key + secret + session token) that doesn't fit the current `CredentialPool` (string-only). Forward-compat: `AuthType "aws_sigv4"` slot reserved.

## Consequences

- Documented limitation.
- Enterprise customers in SigV4-only environments (no permission to mint Bearer) wait for v1.x.
