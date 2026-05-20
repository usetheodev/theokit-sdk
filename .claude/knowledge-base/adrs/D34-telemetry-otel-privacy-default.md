# D34 — Telemetry: OpenTelemetry spans, privacy-by-default, lazy load

**Status:** Decided
**Date:** 2026-05-17

## Decision

The SDK ships an optional telemetry subsystem built on OpenTelemetry
semantics. Configuration lives in `AgentOptions.telemetry`:

- `enabled: boolean` — default `false`. When `true`, the SDK emits
  spans for `agent.send`, `llm.call`, `tool.call`, and
  `memory.search`.
- `includeContent?: boolean` — default `false`. When `true`, span
  events include prompt/response text and tool arguments. **Off by
  default — prompts may contain user PII or secrets**.
- `exporter?: "console" | "otlp" | TelemetryExporter` — default
  `"console"`. OTLP exporter forwards to a configurable endpoint.
- `serviceName?: string` — default `"theokit-sdk"`.

`@opentelemetry/api` is an OPTIONAL peer dependency loaded lazily via
`createRequire` (same pattern as `zod` in D24). Consumers who don't
enable telemetry never need OTel installed. ALL OTel calls (`span.end`,
`addEvent`, `setAttributes`, `exporter.export`) are wrapped in a
`safe()` helper that swallows exceptions and logs once to stderr — a
broken exporter NEVER propagates into `agent.send`.

## Rationale

Observability is mesa stakes in 2026. Production consumers need
distributed traces, latency histograms, and span attributes to debug
agent behaviour at scale. OTel is the de-facto standard with broad
backend support (Jaeger, Tempo, Honeycomb, Datadog, etc).

Privacy-by-default closes a footgun: prompts often contain user
queries, API keys mistakenly pasted, or PII. A consumer enabling
telemetry shouldn't be surprised to find user prompts in their tracing
backend. Opt-in to content is explicit and JSDoc-documented as the
consumer's responsibility to sanitize.

Lazy load via `createRequire` mirrors the `zod` pattern (D24). It
keeps the published SDK dist free of `import "@opentelemetry/api"` at
module top level, so consumers who never enable telemetry don't need
the OTel packages installed.

The `safe()` wrapper closes a real failure mode: a misconfigured OTLP
exporter throwing on `exporter.export(spans)` would otherwise bubble
through `agent.send` and crash the bot. Telemetry side effects MUST
NEVER be load-bearing.

## Consequences

- Zero overhead when `enabled: false`: the spans helper short-circuits
  before any OTel call.
- Zero install cost when telemetry isn't used: OTel deps stay
  uninstalled.
- Span schema (names, attributes) is part of the SDK contract — we
  document it in `docs.md` so external observability tooling can rely on
  consistent names across SDK versions.
- Privacy default means consumers must opt into content logging when
  they want full audit trails — slight DX friction but appropriate for
  enterprise / regulated contexts.
- The OTel API surface is stable but versions independently — our
  `tracer.ts` wrapper isolates the API so version bumps stay local.
