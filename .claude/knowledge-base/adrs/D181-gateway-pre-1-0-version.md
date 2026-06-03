# D181 — Initial gateway packages ship at `0.1.0` (pre-1.0)

**Date:** 2026-05-21
**Status:** Accepted

## Decision

`@theokit/gateway`, `@theokit/gateway-telegram`, and `@theokit/gateway-discord` all publish at version `0.1.0`. Breaking changes are allowed within the `0.x.y` line per semver minor bumps. Promotion to `1.0.0` requires (a) at least one quarter of real-world use AND (b) a third adapter validating the abstraction contract.

## Rationale

No real users yet — locking the API at 1.0 before two adapters have exercised it would be premature. The memory adapters (D143) shipped at `0.1.0` for the same reason. v0.x lets us iterate the contract based on dogfood feedback without semver-induced friction.

## Consequences

- **Enables:** rapid iteration on the contract based on dogfood + early-user feedback.
- **Constrains:** consumers see the `0.x` version and know to pin exactly. Documented in each package README.
