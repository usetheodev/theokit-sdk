# V4-A — Diagnóstico de adoção: por que o theocode não usa `@theokit/agents`

> **Data:** 2026-06-23 · **Tipo:** diagnóstico empírico in-repo (gate do ROADMAP-v4) · **Verdict:** GAP CONFIRMADO E LOCALIZADO
> Pergunta: *por que o app de referência (theocode) evita o `@theokit/agents` mesmo com `@Agent`/`@Tool` prontos?*

## Método

Leitura cruzada de (a) o que o `@theokit/agents@0.5.0` expõe e EXECUTA, contra (b) o que o agente do theocode realmente precisa. Sem suposição — só evidência de código (`file:line`).

## O que o `@theokit/agents` cobre HOJE

| Capacidade | Estado | Evidência |
|---|---|---|
| Declaração de agente (convention-over-config, Rails-style) | ✅ runtime real | `src/decorators/agent.ts` (`@Agent`, infer name/route) |
| Tools / Toolbox / guards | ✅ runtime real | `src/decorators/tool.ts` (`@Tool`/`@Toolbox`/`@UseGuards`, ADR D7) |
| Skills / Memory / ContextWindow / ProjectContext | ✅ runtime real (M8) | `bridge/compile-*.ts` (ADR 0031) |
| Streaming **single-shot** (um `Run.stream()`) | ✅ runtime real | `bridge/agent-orchestrator.ts:159-172` (`for await` sobre 1 stream) |
| **Loop multi-round / reflexão** (`@MainLoop` strategy) | ❌ **METADATA-ONLY** | ver abaixo |

## O gap, localizado com precisão: `@MainLoop` é metadata-only

`@MainLoop` **existe e é obrigatório** — `walk-agent-metadata.ts:5` ("throws if @Agent class is missing @MainLoop"). Ele declara:

```ts
// src/types.ts
strategy?: 'simple-chat' | 'plan-act-reflect' | 'react'
maxIterations?: number
```

Esses valores são **armazenados** (`setMeta`), **compilados** (`agent-compiler.ts:135` → `CompiledAgentOptions.maxIterations`) e **surgem no manifest** (`agent-manifest.ts:61`). **MAS o runtime os ignora:**

- O orquestrador (`bridge/agent-orchestrator.ts`) **não tem nenhum branch** em `strategy` — `grep -E "plan-act-reflect|react|reflect|round|iteration|while"` retorna **vazio**.
- Ele só faz `for await (const event of streamFactory(message, sessionId))` (`:165`) — **um** `Run.stream()`, single-shot.
- `maxIterations` é compilado mas **nunca lido** num loop de execução.

→ **`@MainLoop({ strategy: 'plan-act-reflect' })` é uma promessa não cumprida.** É o mesmíssimo anti-pattern "decorator-without-runtime" que o M8/ADR-0031 consertou para `@ContextWindow`/`@ProjectContext`/`@Skills` — **mas que sobreviveu para o `@MainLoop`.** (M8 fechou os knobs de config; deixou o loop aberto.)

## O que o theocode precisa (e por isso não adota)

| theocode hand-roll | LoC | Mapeia para |
|---|---|---|
| `agent-stream.ts` (outer loop streaming + classifyRoundOutcome + no-progress + continuation) | 470 | `@MainLoop` strategy = **`react`** (metadata-only) |
| `agent-loop.ts` (reflection ladder: reflect/verify/verify-fix por outcome) | 248 | `@MainLoop` strategy = **`plan-act-reflect`** (metadata-only) |

A necessidade central do theocode (loop reflexivo multi-round) é **exatamente** o que o `@MainLoop` *declara* mas *não executa*.

## Causa-raiz da não-adoção (conclusão honesta)

Se o theocode declarasse `@Agent` + `@MainLoop({ strategy: 'plan-act-reflect' })`, o `strategy` seria **no-op** → ele receberia chat single-shot, **não** sua reflection ladder. Resultado: ele **ainda** escreveria os 718 LoC de orquestração à mão, agora num codebase **partido** entre shell declarativo e cérebro imperativo, **para zero ganho funcional**. Evitar é a decisão racional — e o prompt do theocode formaliza isso ("does NOT use them").

**Não é falta de feature de declaração. É promessa de orquestração não cumprida.**

## Implicação para o ROADMAP-v4

O V4 é, com precisão, **"M8 Fase 2": dar runtime ao `strategy` do `@MainLoop`** (`plan-act-reflect`/`react`), exatamente como o M8 deu runtime ao `@ContextWindow`/`@Skills` — continuação direta do padrão ADR-0031, não arquitetura nova.

- `ReflectionStrategy` (V4-C) = a implementação de `strategy: 'plan-act-reflect'`.
- `LoopStrategy` + `AgentRunner` (V4-D) = a implementação de `strategy: 'react'` + o gêmeo imperativo (builder) do `@MainLoop`.
- Builder (V4-B) = a forma fluente de compor o que o `@MainLoop` declara (Spring Boot: decorator OU builder, mesma runtime).
- A prova: o theocode adota `@MainLoop({strategy:'plan-act-reflect'})` e deleta `agent-loop.ts` + colapsa `agent-stream.ts`.

## Citações (re-verificar se o pacote mudar)

- `theokit/packages/agents/src/types.ts` — `MainLoopOptions.strategy`, `maxIterations`
- `theokit/packages/agents/src/decorators/main-loop.ts` — `@MainLoop` (obrigatório)
- `theokit/packages/agents/src/bridge/walk-agent-metadata.ts:5` — `@MainLoop` mandatory
- `theokit/packages/agents/src/bridge/agent-compiler.ts:135` — `maxIterations` compilado
- `theokit/packages/agents/src/bridge/agent-orchestrator.ts:159-172` — single-shot (sem branch em strategy)
- `theokit/packages/agents/src/manifest/agent-manifest.ts:61` — strategy surfaceado (mas metadata-only)
- `theocode/server/lib/agent-stream.ts` (470) · `agent-loop.ts` (248) — o loop reflexivo que o theocode precisa
