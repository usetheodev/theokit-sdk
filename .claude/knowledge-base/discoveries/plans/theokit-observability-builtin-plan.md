---
slug: theokit-observability-builtin
version: "1.0"
owner: paulo
created_at: 2026-06-09
status: active
---

# Discovery Plan: TheoKit Built-in Observability via Adapter Registry

## Context

TheoKit's website promises "RAG, memory, and observability — built in" as a core differentiator. The cross-validation against Mastra scored Observability at 2/5. The SDK now has 7 telemetry adapters, but the **framework** (theokit) has no adapter-registry pattern for observability — only raw `logRequest()` and `TraceContext` propagation.

The goal is to design a **framework-level observability adapter registry** with:
- `console` adapter (dev mode default)
- `theo-cloud` adapter (OTLP export to TheoCloud — zero config on deploy)
- `custom` adapter (user-extensible via `defineObservabilityAdapter()`)
- Auto-instrumentation middleware (every request gets spans, metrics, logs)

TheoCloud injects `THEO_CLOUD_INGEST_URL` on deploy — the adapter auto-detects and emits OTLP. Developer writes zero config.

**Trigger:** Cross-validation gap D7 (Observability 2/5) + website promise mismatch + TheoCloud product strategy.

## Objective

> "Produce a blueprint describing the adapter-registry architecture, OTLP wire format, auto-instrumentation middleware pattern, and TheoCloud zero-config DX — citing concrete patterns from Vercel AI SDK, Hono, and OpenTelemetry JS — so that `/to-plan` can produce an implementation plan for framework-level built-in observability."

Success criteria: blueprint answers all 8 research questions with file:line evidence from references.

## Investigation Targets

### Reference 1: Vercel AI SDK
- **Path:** `/tmp/ref-vercel-ai`
- **In scope:** `packages/ai/src/telemetry/` (registry, dispatcher, options), `packages/otel/src/` (OTel integration)
- **Out of scope:** `packages/ui/`, `packages/react/`, `examples/`, `docs/`
- **Budget:** 2h

### Reference 2: Hono
- **Path:** `/tmp/ref-hono`
- **In scope:** `src/middleware/logger/`, `src/middleware/timing/`, `src/types.ts` (Context type)
- **Out of scope:** `src/adapter/`, `src/jsx/`, `src/client/`, `benchmarks/`
- **Budget:** 1h

### Reference 3: OpenTelemetry JS
- **Path:** `/tmp/ref-otel-js`
- **In scope:** `experimental/packages/otlp-transformer/src/` (serialization), `experimental/packages/exporter-trace-otlp-http/src/` (HTTP export), `api/src/` (Span/Tracer interfaces)
- **Out of scope:** `packages/sdk-metrics/`, `packages/sdk-logs/`, `selenium-tests/`, `doc/`
- **Budget:** 2h

## ADRs

### ADR-D1: Framework-level, not SDK-level

**Decision:** The adapter registry lives in the theokit **framework** (`packages/theo/src/server/observability/`), not in the SDK. The SDK already has its own telemetry adapters; the framework needs its own because it controls the HTTP lifecycle (request → route → handler → response) which the SDK cannot see.

**Alternatives:** (a) Use SDK adapters from the framework — REJECTED, SDK adapters are agent-scoped (LLM calls, tool dispatch); framework needs request-scoped spans. (b) Single adapter registry shared — REJECTED, different lifecycle concerns (SRP).

### ADR-D2: OTLP as wire format (not vendor-specific)

**Decision:** The theo-cloud adapter emits OTLP/HTTP (JSON-encoded `ExportTraceServiceRequest`), not a proprietary format. TheoCloud's ingest endpoint accepts standard OTLP. This means any OTLP-compatible backend (Jaeger, Grafana Tempo) can receive the same data if the user self-hosts.

**Alternatives:** (a) Proprietary binary format — REJECTED, lock-in. (b) Prometheus exposition format — REJECTED, pull-based doesn't fit push traces.

### ADR-D3: No Datadog/vendor adapters built-in

**Decision:** Ship only `console` + `theo-cloud` + `custom`. Users who want Datadog/Grafana use the `custom` escape hatch or configure OTLP-compatible receivers. TheoCloud IS the observability product.

**Alternatives:** (a) Ship 5+ vendor adapters — REJECTED, competes with TheoCloud value prop. (b) No custom adapter — REJECTED, escape hatch is essential for self-host users.

## Research Questions

### Techniques Corner

**Q1: How does Vercel AI SDK define the telemetry lifecycle contract (start/end spans, nested calls)?**
- Corner: Techniques
- Method: Read `/tmp/ref-vercel-ai/packages/ai/src/telemetry/telemetry.ts` + `create-telemetry-dispatcher.ts`
- Answer format: Interface definition + event flow diagram (which callbacks fire when)

**Q2: How does Hono's middleware pattern inject timing/logging into the request lifecycle?**
- Corner: Techniques
- Method: Read `/tmp/ref-hono/src/middleware/logger/index.ts` + `src/middleware/timing/timing.ts`
- Answer format: Middleware signature + context binding pattern

**Q3: How does OpenTelemetry JS serialize spans to OTLP JSON wire format?**
- Corner: Techniques
- Method: Read `/tmp/ref-otel-js/experimental/packages/otlp-transformer/src/trace/json/trace.ts` + `src/i-serializer.ts`
- Answer format: Serialization contract (ReadableSpan[] → bytes) + field mapping

### Integration Tests Corner

**Q4: How does Vercel AI SDK test telemetry integration (span emission, attribute correctness)?**
- Corner: Integration Tests
- Method: Grep `test` in `/tmp/ref-vercel-ai/packages/ai/src/telemetry/` and `/tmp/ref-vercel-ai/packages/otel/`
- Answer format: Test file paths + assertion patterns (what do they assert on spans?)

**Q5: How does Hono test middleware (logger/timing) end-to-end?**
- Corner: Integration Tests
- Method: Find test files in `/tmp/ref-hono/src/middleware/logger/` and `/tmp/ref-hono/src/middleware/timing/`
- Answer format: Test patterns (mock request → assert log output)

### Dependencies Corner

**Q6: What OTel packages does Vercel AI SDK depend on, and which are peer vs direct?**
- Corner: Dependencies
- Method: Read `/tmp/ref-vercel-ai/packages/otel/package.json`
- Answer format: dep list with version ranges + peer/direct classification

**Q7: What is the minimal set of OTel packages needed for OTLP/HTTP trace export?**
- Corner: Dependencies
- Method: Read `/tmp/ref-otel-js/experimental/packages/exporter-trace-otlp-http/package.json`
- Answer format: Minimal dep tree for standalone OTLP exporter

### Tools Corner

**Q8: How does Vercel AI SDK register its OTel integration at app boot (automatic vs manual)?**
- Corner: Tools
- Method: Read `/tmp/ref-vercel-ai/packages/otel/src/open-telemetry.ts` — constructor + init flow
- Answer format: Boot sequence (what happens at import time vs runtime init)

## Coverage Matrix

| # | Question | Corner | Method | Reference Path | Status |
|---|----------|--------|--------|----------------|--------|
| Q1 | Telemetry lifecycle contract | Techniques | Read | `/tmp/ref-vercel-ai/packages/ai/src/telemetry/telemetry.ts` | pending |
| Q2 | Middleware timing pattern | Techniques | Read | `/tmp/ref-hono/src/middleware/logger/index.ts` | pending |
| Q3 | OTLP JSON serialization | Techniques | Read | `/tmp/ref-otel-js/experimental/packages/otlp-transformer/src/trace/json/trace.ts` | pending |
| Q4 | Telemetry test patterns | Integration Tests | Grep | `/tmp/ref-vercel-ai/packages/otel/` | pending |
| Q5 | Middleware test patterns | Integration Tests | Find | `/tmp/ref-hono/src/middleware/` | pending |
| Q6 | OTel dependency tree | Dependencies | Read | `/tmp/ref-vercel-ai/packages/otel/package.json` | pending |
| Q7 | Minimal OTLP exporter deps | Dependencies | Read | `/tmp/ref-otel-js/experimental/packages/exporter-trace-otlp-http/package.json` | pending |
| Q8 | Boot-time registration | Tools | Read | `/tmp/ref-vercel-ai/packages/otel/src/open-telemetry.ts` | pending |

**Coverage: 8/8 questions mapped. 4/4 corners covered (Techniques: 3, Integration Tests: 2, Dependencies: 2, Tools: 1).**

## Halt-loop Checkpoints

For `/discover-execute`:

1. After Q1-Q3 (Techniques): intermediate blueprint draft with interface + middleware + serialization sections filled
2. After Q4-Q5 (Tests): test strategy section added to blueprint
3. After Q6-Q7 (Deps): dependency recommendation section added
4. After Q8 (Tools): boot/init section added, blueprint complete

Each checkpoint: every question in the batch has status=`done` OR status=`blocked` with reason.

## Acceptance Criteria

- All 8 questions answered with file:line citations from reference projects
- Blueprint at `knowledge-base/discoveries/blueprints/theokit-observability-builtin-blueprint.md`
- Blueprint has 4 coverage corner sections populated
- At least 1 ADR section in the blueprint
- Every citation resolves to a real file in `/tmp/ref-*`
- No premature implementation — blueprint describes WHAT to build, not the code itself

## Global Definition of Done

- `/discover-confidence` score >= SHIPPABLE_WITH_CAVEATS (70+)
- Zero fabricated citations
- All 4 coverage corners populated
- Blueprint ready as input for `/to-plan theokit-observability-builtin`
