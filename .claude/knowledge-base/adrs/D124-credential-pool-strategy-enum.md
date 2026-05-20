# D124 — `CredentialPoolStrategy` is a closed enum (4 values)

**Date:** 2026-05-20
**Status:** Accepted

## Decision

`CredentialPoolStrategy = "fill_first" | "round_robin" | "least_used" | "random"`. Closed enum, TypeScript exhaustiveness check on `selectByStrategy`. Default `"fill_first"`.

## Rationale

Hermes ships these exact 4 (`agent/credential_pool.py:59-68`). Closed enum forces compile-time completeness — adding a strategy is a deliberate semver-minor decision with an exhaustive `switch` update. `fill_first` aligns with least-surprise — most callers with 2 keys want "burn key A first, switch on exhaustion".

## Consequences

- **Enables:** TS-driven exhaustiveness, predictable behavior, matches Hermes for porting confidence.
- **Constrains:** Weighted/sticky strategies require a future ADR + minor bump.
