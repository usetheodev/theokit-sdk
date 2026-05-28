# D396 — SMS Budget integration deferred to v0.2

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

v0.1 does NOT integrate `@usetheo/sdk` Budget namespace per outbound SMS.

## Rationale

Budget primitive (D375-D388) is token-based; SMS pricing is per-message + provider/destination-variable. Adapting requires per-platform pricing model — separate scope.

## Consequences

Callers tracking SMS cost wrap charges manually. v0.2 may add `chargePerMessage: true` opt-in.
