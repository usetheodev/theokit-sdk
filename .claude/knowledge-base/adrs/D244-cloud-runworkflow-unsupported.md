# D244 — `CloudAgent` workflow steps throw `UnsupportedRunOperationError`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

v1 implements workflows only for `LocalAgent`. `AgentStep` with a `CloudAgent` target throws `UnsupportedRunOperationError` at dispatch time, with a message pointing to the cloud roadmap.

## Rationale

Cloud runtime (Theo PaaS) is still pre-release per root CLAUDE.md. Workflows need fine-grained control (cancellation, snapshot serialization across compute boundaries) not yet modeled in the cloud payload. Consistent with D122 (`runUntil` cloud-unsupported), D169 (`personality` cloud-unsupported).

## Consequences

- `examples/workflows/` documented as "local-only".
- Cloud parity enters the roadmap when PaaS ships (same as other features).
- No CloudAgent workflow API surface exposed; type-level error is acceptable since `runWorkflow` is not a method.
