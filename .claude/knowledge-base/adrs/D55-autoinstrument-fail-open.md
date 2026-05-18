# D55 — Auto-instrumentation no telegram-pro é "fail-open"

**Status:** Decided
**Date:** 2026-05-17

## Decision

`agent.ts` do telegram-pro habilita `telemetry.autoDetect: true` por default. Se `@langfuse/node`, `@sentry/node` ou `posthog-node` estão instalados pelo user (cada um é optional peer dep), o SDK auto-registra os exporters OTel. Se NENHUM está instalado, o bot funciona idêntico ao v1.1 (console exporter only).

Bot start path nunca falha por causa de telemetry — todos os calls de instrumentation são wrapped em `safe()` pelo SDK (ADR D34/D42).

## Rationale

- **Promessa zero-config**: dev que quer Langfuse instala `pnpm add @langfuse/node`, seta `LANGFUSE_PUBLIC_KEY`, restarta o bot → traces aparecem. Sem editar código.
- **Backward compat absoluta**: user que NÃO instalou nenhum vendor (caso default) tem comportamento idêntico ao v1.1.
- **Pattern já provado no SDK**: ADR D42 garante feature-detect graceful skip.

Alternativas consideradas:

- **Auto-detect só quando ENV var explícita**: rejeitado — quebra "zero-config".
- **Erro hard quando vendor instalado sem env keys**: rejeitado — instalar dep + esquecer env é cenário comum; bot crash é exagero.
- **Listar adapters detectados num command (/telemetry)**: maybe future; v1.2 keep it implicit.

## Consequences

- Telegram-pro README documenta as 3 vendors suportados + install commands.
- Versões testadas: Langfuse v3+, Sentry node v7+, posthog-node v3+. Versões incompatíveis (Langfuse v2, etc) → SDK detecta via feature missing + skip silencioso (stderr warning once).
- EC-10 (review): vendor SDK versão incompatível é fail-open garantido por D55; README lista versões testadas explicitamente.
- Stderr pode mostrar `[theokit-sdk] telemetry: <vendor> auto-instrumented` linha quando vendor é detectado. Esse é o feedback visível para dev confirmar que funcionou.
