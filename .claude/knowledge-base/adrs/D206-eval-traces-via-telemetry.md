# D206 — Eval traces piggyback on `Telemetry` (D34); no parallel tracer

**Date:** 2026-05-22
**Status:** Accepted

## Decision

When `AgentOptions.telemetry.enabled === true` is in effect (passed via
`EvalOptions.agent`), `Eval.run` emits a parent span `eval.run` with child
`eval.row` spans per dataset entry; per-scorer spans `scorer.<name>` nest
inside each row. Existing `agent.send` / `llm.call` / `tool.call` /
`memory.search` spans (D34) nest correctly under `eval.row`.

The OTel API is loaded lazily via `createRequire("@opentelemetry/api")` and
all span calls are wrapped in `safe()` — broken exporters NEVER propagate.

## Rationale

- **One observability surface.** SDK already has D34. Parallel tracer would
  double dep weight, force two exporter configs, break the unified surface.
- **Existing collectors work.** Datadog / Honeycomb / OTLP receivers see
  eval runs for free.

Alternatives rejected:

- **Custom EvalTracer** — duplicates D34 infrastructure.
- **Always-on tracing** — privacy violation; D34 is off by default.

## Consequences

- Enables: zero-config OTel for consumers with D34 enabled.
- Constrains: no OTel = flat trace (no parent span); consumers without
  telemetry get `traces?: undefined` on EvalRun.
