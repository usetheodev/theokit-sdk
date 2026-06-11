# Blueprint: TheoKit Built-in Observability via Adapter Registry

**Slug:** `theokit-observability-builtin`
**Version:** 1.0
**Date:** 2026-06-09
**Status:** COMPLETE (8/8 questions answered, 0 blocked)

## Executive Summary

This blueprint describes how to build a framework-level observability adapter registry for TheoKit that makes observability **zero-config for TheoCloud users** and **extensible for self-host users**. The design draws from three SOTA references: Vercel AI SDK's event-based telemetry dispatcher, Hono's middleware context-binding pattern, and OpenTelemetry JS's OTLP serialization contract.

The result: every TheoKit app emits structured spans, metrics, and logs automatically. When deployed to TheoCloud, data flows to the built-in dashboard with zero configuration. When self-hosted, users implement `defineObservabilityAdapter()` to route to any backend.

---

## Coverage Corner 1 — Techniques

### Pattern 1: Event Dispatcher with Lifecycle Callbacks (from Vercel AI SDK)

**Source:** `/tmp/ref-vercel-ai/packages/ai/src/telemetry/telemetry.ts:85-247`

Vercel AI SDK defines a `Telemetry` interface with 14 lifecycle callbacks across 3 hierarchical levels:
- **Operation level:** `onStart`, `onEnd`, `onAbort`, `onError`
- **Step level:** `onStepStart`, `onStepEnd`
- **Execution level:** `onLanguageModelCallStart/End`, `onToolExecutionStart/End`

Nested spans are created via `executeLanguageModelCall` and `executeTool` wrapper methods that receive an `execute` function and return its result, allowing integrations to wrap the execution context with parent-child span relationships.

**Recommendation for TheoKit:** Adopt a simplified 3-level callback interface:
```
ObservabilityAdapter {
  onRequest(ctx)      → request-level span (HTTP lifecycle)
  onAgentCall(ctx)    → agent-level child span (Agent.send, Agent.stream)
  onToolCall(ctx)     → tool-level child span (tool dispatch, MCP)
}
```

### Pattern 2: Middleware Context Binding (from Hono)

**Source:** `/tmp/ref-hono/src/middleware/logger/index.ts:81-95`, `/tmp/ref-hono/src/middleware/timing/timing.ts:76-126`

Hono's approach: middleware wraps `next()` with before/after hooks. Timing state is stored in context variables (`c.set('metric', {...})`). Helpers like `startTime(c, name)` and `endTime(c, name)` manipulate a `Map<string, Timer>` on the context object.

Key insight: **timing data serializes to the `Server-Timing` HTTP response header** (format: `name;dur=value;desc="description"`). This is free observability visible in browser DevTools without any backend.

**Recommendation for TheoKit:** Use the existing `PluginContext` (`server/plugin-types.ts`) to store the active span + timer state. The observability middleware registers as a standard theokit plugin via `onRequest` + `onResponse` hooks. Server-Timing header emission is a cheap bonus for dev mode.

### Pattern 3: OTLP Serialization via ISerializer (from OpenTelemetry JS)

**Source:** `/tmp/ref-otel-js/experimental/packages/otlp-transformer/src/i-serializer.ts:9-21`, `/tmp/ref-otel-js/experimental/packages/otlp-transformer/src/trace/json/trace.ts:12-35`

The contract is minimal:
```typescript
interface ISerializer<Request, Response> {
  serializeRequest(request: Request): Uint8Array | undefined;
  deserializeResponse(data: Uint8Array): Response;
}
```

The `JsonTraceSerializer` converts `ReadableSpan[]` → JSON string → `Uint8Array` via `TextEncoder.encode(JSON.stringify(request))`. The wire format follows OTLP `ExportTraceServiceRequest` shape.

**Recommendation for TheoKit:** The theo-cloud adapter does NOT need the full OTel SDK. It can serialize spans directly to OTLP JSON using a lightweight in-house serializer (~50 LoC) that matches the wire format. This avoids the 5-package OTel dependency tree for the common case. Users who want full OTel can use the `custom` adapter with `@opentelemetry/*` packages.

---

## Coverage Corner 2 — Integration Tests

### How Vercel AI SDK Tests Telemetry

**Source:** `/tmp/ref-vercel-ai/packages/ai/src/telemetry/create-telemetry-dispatcher.test.ts`, `/tmp/ref-vercel-ai/packages/ai/src/telemetry/telemetry-registry.test.ts`

Test patterns:
1. **Mock integration via `vi.fn()`** — create a mock object implementing `Telemetry` interface, pass to dispatcher, assert methods are called with expected event shapes
2. **Error isolation** — one failing integration does NOT block others (dispatcher catches per-integration errors)
3. **Lifecycle ordering** — assert `onStart` fires before `onStepStart` before `onLanguageModelCallStart` (temporal ordering contract)
4. **Global vs per-call registration** — test that per-call integrations take precedence over global registry

**Recommendation for TheoKit:** Test the adapter registry with mock adapters (vi.fn). Assert: (a) adapter.onRequest called per HTTP request, (b) error in one adapter doesn't crash the server, (c) console adapter logs to stderr, (d) theo-cloud adapter serializes OTLP correctly.

### How Hono Tests Middleware

**Source:** `/tmp/ref-hono/src/middleware/logger/index.test.ts`, `/tmp/ref-hono/src/middleware/timing/index.test.ts`

Test patterns:
1. **`app.request()` integration pattern** — create a Hono app, register middleware, make a request via `app.request('http://localhost/path')`, assert response + side effects
2. **Spy function capture** — pass `vi.fn()` as the log function, assert it was called with expected format
3. **Server-Timing header assertion** — check response header `includes('total;dur=')`

**Recommendation for TheoKit:** Use the existing Vitest setup. Create a minimal theokit server in test, register the observability plugin, make a request via `fetch()` against the test server, assert: (a) response has Server-Timing header (dev mode), (b) adapter received the span, (c) span has correct attributes (method, path, status, duration).

---

## Coverage Corner 3 — Dependencies

### Vercel AI SDK OTel Dependencies

**Source:** `/tmp/ref-vercel-ai/packages/otel/package.json`

Vercel AI SDK's OTel package depends on only:
- `@opentelemetry/api` ^1.9.1 (peer dep — types only, ~30KB)
- No other `@opentelemetry/*` packages as direct deps

The tracer is injected at construction time: `options.tracer ?? trace.getTracer('gen_ai')`. Users who want full OTel install `@opentelemetry/sdk-trace-base` themselves.

### Minimal OTLP HTTP Exporter Dependencies

**Source:** `/tmp/ref-otel-js/experimental/packages/exporter-trace-otlp-http/package.json`

Full OTel OTLP exporter requires 5 packages:
- `@opentelemetry/api` ^1.3.0 (peer)
- `@opentelemetry/core` 2.7.1
- `@opentelemetry/otlp-exporter-base` 0.218.0
- `@opentelemetry/otlp-transformer` 0.218.0
- `@opentelemetry/sdk-trace-base` 2.7.1

**Recommendation for TheoKit:** Do NOT add the full OTel dep tree for the default path. Instead:
- **theo-cloud adapter:** In-house OTLP JSON serializer using native `fetch` + `TextEncoder` (~50 LoC, zero deps). The wire format is documented and stable.
- **custom adapter:** Users who want full OTel compatibility install `@opentelemetry/api` themselves and pass their configured tracer. The adapter interface accepts an OTel-compatible tracer optionally.

This keeps the default install size minimal while allowing full OTel for advanced users.

---

## Coverage Corner 4 — Tools (Boot/Init)

### Vercel AI SDK Boot Sequence

**Source:** `/tmp/ref-vercel-ai/packages/otel/src/open-telemetry.ts:96-100`

Boot sequence:
1. **Import-time:** Class loaded, no global side effects
2. **Construction:** `new OpenTelemetry({ tracer? })` — receives optional tracer, defaults to `trace.getTracer('gen_ai')` (global OTel API)
3. **Registration:** User passes instance to SDK call options: `generateText({ ..., telemetry: { integrations: [otel] } })`
4. **Per-call dispatch:** Dispatcher resolves integrations (local > global), fans out lifecycle events

Key design: **no global singleton required**. Users can have different integrations per call.

**Recommendation for TheoKit:** Follow the same lazy-init pattern:
1. `theo.config.ts` declares `observability: { provider: "theo-cloud" }` (or auto-detected from env)
2. At server boot (`configureServerHook` in Vite plugin), the adapter registry resolves the provider
3. The observability middleware plugin is registered into the plugin runner
4. Per-request: middleware creates span, passes to handler context, finalizes on response

Auto-detection priority:
```
1. THEO_CLOUD_INGEST_URL set       → theo-cloud adapter
2. theo.config.ts observability     → configured adapter
3. NODE_ENV === "development"       → console adapter
4. fallback                         → noop (silent)
```

---

## ADRs

### ADR-D1: Framework-level adapter registry (not SDK-level)

The framework controls the HTTP lifecycle (request → route → handler → response). The SDK's telemetry adapters are agent-scoped (LLM calls, tool dispatch). Both emit to different span hierarchies. SRP demands separate registries.

### ADR-D2: OTLP wire format (not proprietary)

TheoCloud's ingest endpoint accepts standard OTLP/HTTP. This means any OTLP-compatible backend (Jaeger, Grafana Tempo, self-hosted collector) can receive the same data. No vendor lock-in at the wire format level.

### ADR-D3: In-house OTLP serializer (not full OTel SDK)

The full OTel exporter requires 5 packages (~200KB). The OTLP JSON format is documented and stable — a 50 LoC serializer covers the common case. Advanced users who want full OTel use the `custom` adapter with their own tracer. Per KISS + YAGNI.

### ADR-D4: Auto-detection priority chain

Following Vercel AI SDK's pattern of "no global singleton required" — the adapter is resolved once at boot from environment + config, not from a global registration call. This makes the behavior deterministic and testable.

---

## Proposed Architecture

```
theo.config.ts
  └── observability: { provider: "theo-cloud" | "console" | adapter }

server/observability/
  ├── adapter-registry.ts          ← resolves provider from config + env
  ├── adapters/
  │   ├── types.ts                 ← ObservabilityAdapter interface
  │   ├── console.ts               ← dev mode (JSON to stderr)
  │   ├── theo-cloud.ts            ← OTLP/HTTP to TheoCloud
  │   └── noop.ts                  ← silent fallback
  ├── middleware.ts                ← auto-instrument plugin (onRequest/onResponse)
  ├── span.ts                     ← SpanHandle type + builder
  ├── otlp-serializer.ts          ← lightweight JSON OTLP encoder
  └── (existing) logger.ts, request-log.ts, trace-context-propagation.ts

defineObservabilityAdapter() ← public API for custom adapters
```

### ObservabilityAdapter Interface (proposed)

```typescript
interface ObservabilityAdapter {
  readonly name: string;
  startSpan(name: string, attrs?: Record<string, unknown>): SpanHandle;
  counter(name: string, value?: number, attrs?: Record<string, unknown>): void;
  histogram(name: string, value: number, attrs?: Record<string, unknown>): void;
  log(level: "debug" | "info" | "warn" | "error", msg: string, attrs?: Record<string, unknown>): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

interface SpanHandle {
  setAttribute(key: string, value: unknown): void;
  setStatus(status: "ok" | "error", message?: string): void;
  end(): void;
}
```

### Zero-Config TheoCloud Flow

```
Developer: theo deploy
TheoCloud:  injects THEO_CLOUD_INGEST_URL + THEO_CLOUD_PROJECT_ID + THEO_CLOUD_API_KEY
Framework:  auto-detects → activates theo-cloud adapter
Adapter:    emits OTLP JSON via fetch() to ingest URL every 5s (batched)
Dashboard:  shows spans, metrics, logs at app.theocloud.dev/project/xxx/observability
```

---

## What This Blueprint Does NOT Cover

- TheoCloud ingest endpoint implementation (proprietary Go service — out of scope)
- SDK-level agent span instrumentation (T0.1 in sdk-superiority plan — separate concern)
- Custom dashboard UI (TheoCloud frontend — separate project)
- Alerting engine (roadmap item per website)
