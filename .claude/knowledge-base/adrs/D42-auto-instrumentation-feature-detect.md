# D42 — Auto-instrumentation de telemetria via createRequire feature-detect

**Status:** Decided
**Date:** 2026-05-17

## Decision

Quando `AgentOptions.telemetry.enabled === true`, o tracer feature-detecta a presença das libs de observabilidade abaixo via `createRequire(import.meta.url)("@vendor/pkg")` e auto-registra os exporters/processadores OTel correspondentes:

- `@langfuse/node` (v3+) — registra `LangfuseSpanProcessor`
- `@sentry/node` — registra event processor que enriquece spans com OTel context
- `posthog-node` — registra custom SpanProcessor que captura `agent.send` + `llm.call` como PostHog events

Default: `telemetry.autoDetect: true`. Opt-out total: `autoDetect: false`. Opt-out per-adapter: `telemetry.disable: ["langfuse"]`.

Cada adapter vive em `internal/telemetry/adapters/{vendor}.ts` expondo a interface:

```ts
interface TelemetryAdapter {
  moduleName: string;
  displayName: string;
  detect: () => boolean;
  register: (provider: TracerProvider) => void;
}
```

Todos os calls de adapter passam pelo `safe()` wrapper já existente (ADR D34) — erros NUNCA propagam para `agent.send`.

## Rationale

- **Zero-config é a promessa core**: dev instala `@langfuse/node`, configura env var (`LANGFUSE_PUBLIC_KEY`), e spans aparecem. Sem editar código do agent.
- **Pattern já provado**: `tracer.ts` v1.1 já usa `createRequire` para `@opentelemetry/api`. Extensão natural, zero novo abuse de Node APIs.
- **Múltiplos adapters coexistem**: user pode ter Langfuse + Sentry simultâneos; ambos recebem spans.
- **Detecção é synchronous + barata**: `createRequire` em-load-time de uma vez; resultado cached.

Alternativas consideradas:

- **Explicit registration via plugin option (`telemetry.adapters: [langfuse(), sentry()]`)**: rejeitado — quebra zero-config; user precisa importar e instanciar; vira boilerplate.
- **NPM postinstall hook**: rejeitado — fragile, problemas com monorepos, alguns gerenciadores de pkg desabilitam scripts.
- **Env var `THEOKIT_TELEMETRY_VENDOR=langfuse`**: rejeitado — quebra "instalou está ligado"; força user a saber sobre flag escondida.

## Consequences

- `@langfuse/node`, `@sentry/node`, `posthog-node` são **NÃO** declarados como deps (nem optional). Auto-detect funciona via "user instala em SEU package.json".
- Versões incompatíveis (e.g., Langfuse v2 quando esperamos v3+) detectadas via try/catch no `.register()` — log warning, skip adapter.
- Provider OTel já manualmente configurado pelo user com Langfuse: detectar `provider.getActiveSpanProcessor()` e skip se já tem Langfuse processor (evita double-billing).
- Env vars ausentes no init do adapter (e.g., sem `LANGFUSE_PUBLIC_KEY`): catch + warn + continue. Adapter sem env vars = no-op.
- Cada adapter <= 100 LoC (objetivo de manutenibilidade).
- Espaço de extensão futura: braintrust, helicone, llmonitor etc. seguem mesmo pattern em `adapters/`.
