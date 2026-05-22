# D220 — Telemetry: emit `handoff.transfer` OTel span linking parent + receiver

**Date:** 2026-05-22
**Status:** Accepted

## Decision

When a handoff fires AND `@opentelemetry/api` is loadable, emit a `handoff.transfer`
span with attributes:
- `handoff.from` (sender agentId)
- `handoff.to` (receiver agentId)
- `handoff.reason` (LLM-generated payload, may be empty)
- `handoff.depth` (current chain depth, post-increment)
- `handoff.tool_name` (the synthetic tool that fired)

Piggybacks on D34 OTel infra (same lazy-load + safe wrapper as eval D206).

## Rationale

- Operability requires seeing the chain in trace tools (Honeycomb, Datadog).
- Reuses existing OTel infrastructure — no parallel tracing system.

## Consequences

- Enables trace-based debugging of multi-agent flows.
- Constrains: no OTel installed = no span (consistent with D206); broken
  exporter NEVER propagates into agent loop.
