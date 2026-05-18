# telemetry-autoinstrument — auto-detect Langfuse / Sentry / PostHog

Demonstrates `AgentOptions.telemetry.autoDetect` (ADR D42). When enabled, the SDK feature-detects installed observability vendors via `createRequire` and auto-registers their OTel exporters. Zero config required beyond installing the vendor library + setting their env keys.

## What it does

**Config-only mode (no provider key):**
- Prints the supported vendors + opt-out flags.
- Exits 0.

**Real mode (with provider key):**
- Creates an agent with `telemetry: { enabled: true, autoDetect: true, includeContent: false }`.
- Sends a single prompt.
- Stderr shows `[theokit-sdk] telemetry: <vendor> auto-instrumented` for each detected vendor.

## Setup

```bash
pnpm install --ignore-workspace
cp .env.example .env
# Set ONE provider key + optionally any vendor keys
```

## Run

```bash
pnpm dev
```

## Activate auto-instrumentation

The SDK detects these vendors when they are installed as deps of your app + their env keys are set:

### Langfuse

```bash
pnpm add @langfuse/node @opentelemetry/api
# .env:
#   LANGFUSE_PUBLIC_KEY=pk-lf-...
#   LANGFUSE_SECRET_KEY=sk-lf-...
```

Requires Langfuse v3+ (the SDK uses `LangfuseSpanProcessor` from `@langfuse/node`; v2 falls back to no-op with a warning).

### Sentry

```bash
pnpm add @sentry/node @opentelemetry/api
# Initialize Sentry BEFORE Agent.create:
#   import * as Sentry from "@sentry/node";
#   Sentry.init({ dsn: process.env.SENTRY_DSN });
```

Auto-instrumentation enriches Sentry events with OTel trace context (`traceId`/`spanId`).

### PostHog

```bash
pnpm add posthog-node @opentelemetry/api
# .env:
#   POSTHOG_API_KEY=phc_...
#   POSTHOG_HOST=https://us.i.posthog.com  # optional, defaults to US
```

Captures `agent.send`, `llm.call`, `tool.call` spans as PostHog events (privacy-respecting per `includeContent`).

## Opt-out

```ts
// Skip ALL auto-instrumentation
telemetry: { enabled: true, autoDetect: false }

// Skip a specific vendor (case-insensitive)
telemetry: { enabled: true, disable: ["langfuse"] }
```

## Privacy

`includeContent: false` (default) — span attributes carry counts, IDs, model names. **NO prompt content, NO completion text, NO tool input/output payloads.**

`includeContent: true` — adds `llm.prompt`, `llm.completion`, `tool.input`, `tool.output` (truncated to 4 KB per attribute). Use with care; never enable in production without exporter-side redaction.

## EC-12 — double-billing prevention

If you've already wired Langfuse manually before creating the agent (e.g., via `provider.addSpanProcessor(new LangfuseSpanProcessor(...))`), the auto-detect skips silently. No double-billing.

## See also

- ADR D42 — `.claude/knowledge-base/adrs/D42-auto-instrumentation-feature-detect.md`
- ADR D34 — `.claude/knowledge-base/adrs/D34-telemetry-otel-privacy-default.md`
- SDK docs: `docs.md` § "Telemetry auto-instrumentation"
- Golden tests: `packages/sdk/tests/golden/agent/telemetry-auto-instrumentation.golden.test.ts`
