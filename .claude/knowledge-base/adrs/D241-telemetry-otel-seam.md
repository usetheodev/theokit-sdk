# D241 — Telemetry uses existing OTel seam; spans `workflow.run` + `workflow.step.<id>`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

`internal/workflow/telemetry.ts` lazy-loads `@opentelemetry/api` via `createRequire`, matching the pattern from D34 (telemetry), D206 (eval), D220 (handoff). Span hierarchy: `workflow.run` (root) → `workflow.step.<id>` (child per step) → repeated `workflow.step.<id>` (grandchild per retry attempt). Standard attributes: `workflow.name`, `workflow.run_id`, `step.kind`, `step.attempt`, `step.status`.

## Rationale

Users without OTel installed pay zero cost (lazy load returns no-op). Pattern is established in 3 prior features. Span names align with documentation conventions (dot.separated, lowercase).

## Consequences

- Tests use a `noop` tracer; integration tests can inject a fake tracer to assert span creation.
- Attributes must be JSON-primitive (no functions, no symbols, no cycles).
- Spans must end in `finally` even on synchronous throws (EC-10 covered by test).
