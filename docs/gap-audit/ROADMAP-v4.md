# ROADMAP-v4 — Declarative Agent Authoring (decorators + builders, o jeito TheoKit)

> **Status:** PROPOSTO · **Revisão 3 (2026-06-23)** — V4-A (diagnóstico empírico) CONCLUÍDO: o gap foi localizado com precisão — não é "orquestração ausente", é **`@MainLoop` metadata-only** (a `strategy: 'plan-act-reflect'|'react'` é declarada e obrigatória, mas o runtime a ignora e faz single-shot). Ver [`V4A-adoption-gap-diagnosis.md`](./V4A-adoption-gap-diagnosis.md). O V4 é, com precisão, **"M8 Fase 2"**: dar runtime ao `@MainLoop` como o M8 deu ao `@ContextWindow`/`@Skills`. (Rev. 2 corrigira a premissa greenfield da v1; rev. 1 errou ao assumir que `@Agent`/`@Tool` não existiam.)
> Escopo: `theokit/packages/agents` (`@theokit/agents`). Prova: `theocode`. Irmão de [`ROADMAP-v2`](./ROADMAP-v2.md) (adoção) e [`ROADMAP-v3`](./ROADMAP-v3.md) (hardening).

---

## 0. Premissa CORRIGIDA — o que já existe (e o que o V4 v1 errou)

### 0.1 A fundação já está construída e em produção

`@theokit/agents@0.5.0` é um pacote shipando com **exatamente a arquitetura que o V4 v1 propôs como "risco alto a provar"**:

- **Metadata registry leve, sem IoC** (`src/metadata/{keys,index}.ts`).
- **Bridge que compila decorator metadata → `Agent.create()` do SDK** (`bridge/walk-agent-metadata.ts` → `agent-compiler.ts` → `sdk-adapter.ts`).
- **Integração no framework** via `agentsPlugin()` (`theokit-plugin.ts`).
- **Decorators de DECLARAÇÃO já implementados:** `@Agent`, `@Tool`, `@Skills`, `@ContextWindow`, `@ProjectContext`, `@Memory`, `@Gateway`, `@Checkpoint`, `@Conversation`.

E as decisões estratégicas que o V4 v1 achou que precisava tomar **já foram tomadas**:

- **ADR 0031 (2026-06-22)** — *"o bridge compila; o SDK executa; nenhum runtime novo; sem IoC."* É o princípio central do V4, já locked.
- **`sdk-runtime.md` (INQUEBRÁVEL)** — "decorators descrevem, bridge compila, SDK executa."
- **O D431 já está reconciliado** — não precisa reabrir. ADR 0031 cravou a regra: *"um decorator ganha runtime quando mapeia para um campo nativo do SDK; senão, avisa metadata-only (nunca silencia)."*

### 0.2 O que o V4 v1 errou (correções de honestidade)

| V4 v1 dizia | Realidade |
|---|---|
| "V4-0: decidir pacote, reabrir D431, provar no-IoC num spike" | **Já feito** — `@theokit/agents` + ADR 0031 + `sdk-runtime.md`. |
| "Tier 1: construir `@Tool`/`@Agent` do zero" | **Já existem** (+ `@Skills`/`@Memory`/`@ContextWindow`/etc.). |
| "Princípio #2: sem `reflect-metadata`, TC39 only" | **ERRADO** — o pacote usa `reflect-metadata` (peer dep) + Legacy decorators, decisão consciente (idêntica ao Pattern D1 da patterns-skill do http-decorators: param-injection precisa de runtime type emit). Honrar, não brigar. |
| "Clonar 5 frameworks pra decidir decorator vs no-IoC" | **Redundante** — respondido in-repo. |

### 0.3 A tese — agora EMPÍRICA (V4-A concluído)

> O `@theokit/agents` cobre **declaração** (`@Agent`/`@Tool`/`@Skills`/...) + streaming **single-shot**. A orquestração **existe declarada** — `@MainLoop({ strategy: 'simple-chat' | 'plan-act-reflect' | 'react' })` é **obrigatória** (`walk-agent-metadata.ts:5`) — **mas é metadata-only**: o orquestrador (`agent-orchestrator.ts`) nunca faz branch em `strategy`; só consome um `Run.stream()`. `maxIterations` é compilado e nunca lido.
>
> **Por isso o theocode não adota:** declarar `@MainLoop({strategy:'plan-act-reflect'})` seria no-op → ele receberia chat single-shot, **não** sua reflection ladder, e ainda escreveria os 718 LoC de orquestração à mão num codebase partido. Zero ganho. (Ver [`V4A-adoption-gap-diagnosis.md`](./V4A-adoption-gap-diagnosis.md).)
>
> **O V4 = "M8 Fase 2": dar RUNTIME ao `strategy` do `@MainLoop`** — `plan-act-reflect` (= ReflectionStrategy) e `react` (= LoopStrategy) — exatamente como o M8 deu runtime ao `@ContextWindow`/`@Skills` (ADR 0031). E (confirmado pelo owner) expor a mesma capacidade **como decorator OU builder fluente, padrão Spring Boot** (três sintaxes, um runtime). É onde os maiores hand-rolls do theocode colapsam — e a promessa que o `@MainLoop` já faz finalmente é cumprida.

---

## 1. Princípios de design (os "padrões claros") — CORRIGIDOS

Os 4 papéis, um runtime (inalterado — e já é a arquitetura do `@theokit/agents`):

| Papel | Mecanismo | Padrão | Estado |
|---|---|---|---|
| **DECLARAR** | Decorator | — | ✅ existe (`@Agent`, `@Tool`, ...) |
| **CONSTRUIR/compor** | Builder fluente | Builder | ❌ **não existe — V4** |
| **VARIAR comportamento** | Strategy nomeada | Strategy | ❌ **não existe — V4** |
| **EXECUTAR** | Factory do SDK | Factory | ✅ existe (`Agent.create`) |

**Restrições inquebráveis (já vigentes via ADR 0031 / `sdk-runtime.md` — o V4 as HONRA):**

1. **Sem IoC container.** Metadata registry + bridge compile→factory. (Já é assim.)
2. **`reflect-metadata` + Legacy decorators é a escolha ESTABELECIDA.** Não inventar TC39-no-reflect-metadata; param-injection precisa de runtime type emit (Pattern D1). Custo: ~3KB gzip opt-in. *(Correção da v1.)*
3. **Harness independente.** Direção `@theokit/agents → @theokit/sdk` only (ADR 0030). O SDK nunca importa a camada.
4. **Decorator ganha runtime só se mapeia para campo nativo do SDK; senão warn metadata-only.** (ADR 0031.) Toda strategy/builder nova do V4 deve compilar para um campo que o SDK executa — ou justificar o warn.
5. **Strategy = interface + factory + default.** `theokit` provê interface + default; `theocode` provê implementação de domínio só quando difere.

---

## 2. O que existe vs o que está aberto (a tabela honesta)

| Camada | `@theokit/agents@0.5.0` | Gap (V4) |
|---|---|---|
| Metadata registry (no-IoC) | ✅ `metadata/` | — |
| Bridge compile→factory | ✅ `bridge/` | — |
| Plugin no framework | ✅ `agentsPlugin()` | — |
| Decorators de declaração | ✅ `@Agent`/`@Tool`/`@Skills`/`@Memory`/`@ContextWindow`/`@ProjectContext`/`@Gateway`/`@Checkpoint`/`@Conversation` | — |
| **Builder fluente** | ❌ | **V4-B** (gêmeo imperativo do `@MainLoop`) |
| **ReflectionStrategy (`@MainLoop strategy:'plan-act-reflect'`)** | ⚠️ declarado **metadata-only** | **V4-C** — dar runtime (theocode 248 LoC) |
| **LoopStrategy / `react` (`@MainLoop strategy:'react'`)** | ⚠️ declarado **metadata-only** | **V4-D** — dar runtime (theocode 470 LoC; depende V3-4) |
| **GuardStrategy + `@Guard`** | ❌ | **V4-E** (theocode 143 LoC; depende V3-1) |
| **CompactionStrategy + `@Compaction`** | ❌ (só `@ContextWindow` knob) | **V4-F** (theocode 150 LoC; depende V3-3) |
| **Starters** | ❌ | **V4-H** |
| **Adoção pelo theocode** | ❌ (o app evita) | **V4-A — diagnóstico (gate de tudo)** |

---

## 3. Headline: antes vs depois — CORRIGIDO

**HOJE** (o `@Agent` já existe, mas a orquestração não — então o theocode nem usa o decorator):

```ts
// @theokit/agents JÁ permite isto:
@Agent({ model, instructions, tools: [...], skills: [...] })
class CodeAgent {}
// ...MAS o theocode ainda escreveria ~720 LoC à mão para o que importa:
//   agent-stream.ts (470): streaming + classifyRoundOutcome + no-progress + continuation
//   agent-loop.ts   (248): reflection ladder (reflect/verify/verify-fix)
// → adotar o @Agent só cobre metade → o theocode não adota.
```

**COM V4** (a orquestração vira declarativa — aí sim a adoção compensa):

```ts
@Agent({ model, instructions, tools: [...] })
@Reflection('ladder')            // V4-C — ReflectionStrategy nomeada
@Guard([ShellGuard])             // V4-E — GuardStrategy (V3-1)
class CodeAgent {}

const runner = AgentRunner.builder(CodeAgent)   // V4-B + V4-D
  .compaction('token-budget', { keepTokens: 8000 })  // V4-F (V3-3)
  .stream(true)                                       // LoopStrategy (V3-4)
  .build();

for await (const event of runner.run(prompt, { cwd })) { /* ... */ }
```

Meta: as ~720 LoC de orquestração do theocode → ~40 LoC + strategies nomeadas e testáveis. **E o theocode finalmente adota** (porque agora cobre o que importa).

---

## 4. Milestones

```
✅ V4-0 FUNDAÇÃO (metadata+bridge+no-IoC) ......... FEITO (ADR 0031 + @theokit/agents)
✅ V4-1 Decorators de declaração (@Agent/@Tool/...) FEITO (@theokit/agents 0.5.0)

   V4-A Diagnóstico de adoção (POR QUE o theocode não usa) ── GATE de tudo
        │
        ├─ V4-B Builder layer (AgentBuilder / AgentRunner.builder())
        │     V4-C ReflectionStrategy + @Reflection          (theocode 248 LoC)
        │     V4-D LoopStrategy + AgentRunner   (V3-4)        (theocode 470 LoC)
        │     V4-E GuardStrategy + @Guard       (V3-1)        (theocode 143 LoC)
        │     V4-F CompactionStrategy + @Compaction (V3-3)    (theocode 150 LoC)
        │     V4-G ContextProvider strategy (estende @ProjectContext)
        │
        └─ V4-H Starters ("qualquer um constrói")
           V4-I Eval builder  (V3-5)
```

### ✅ V4-A — Diagnóstico de adoção (GATE) — CONCLUÍDO (2026-06-23)
**Resultado:** [`V4A-adoption-gap-diagnosis.md`](./V4A-adoption-gap-diagnosis.md). **Gap localizado:** `@MainLoop` é metadata-only — `strategy: 'plan-act-reflect'|'react'` é declarada + obrigatória + compilada + surfaceada no manifest, mas o orquestrador (`agent-orchestrator.ts:159-172`) é single-shot e nunca faz branch nela; `maxIterations` compilado e nunca lido. O theocode não adota porque o que ele precisa (loop reflexivo) é exatamente o que o `@MainLoop` promete e não cumpre. **Implicação:** V4 = "M8 Fase 2" (dar runtime ao `@MainLoop`). Escopo de V4-B..V4-H confirmado.

### V4-B — Builder layer (`AgentBuilder` / `AgentRunner.builder()`) — [x] (shipped @theokit/agents@0.6.0)
**Esforço:** M · **Padrão:** Builder · **Depende de:** V4-A · **Valor:** Alto
A peça fluente que não existe. `AgentRunner.builder(AgentClass).reflection().compaction().stream().build()`. Compõe decorators + strategies → compila para `Agent.create` + driver. **Loop:** theocode constrói o runner via builder.

### V4-C — `ReflectionStrategy` = dar runtime a `@MainLoop strategy:'plan-act-reflect'` — [x] (shipped @theokit/agents@0.6.0)
**Esforço:** M · **Padrão:** Strategy · **Depende de:** V4-B · **Valor:** ALTO (maior ganho)
Implementa o que o `@MainLoop({strategy:'plan-act-reflect'})` já declara mas não executa (metadata-only — V4-A). A reflection ladder de 248 LoC do theocode (`agent-loop.ts`: `classifyRoundOutcome`/`selectReflection`) vira a `ReflectionStrategy` default no `theokit`. Igual ao M8: o bridge compila, o runtime executa. **Loop:** theocode declara `@MainLoop({strategy:'plan-act-reflect'})` (ou `.reflection('ladder')` no builder); `agent-loop.ts` vira a default da strategy (domínio→framework) OU strategy custom.

### V4-D — `LoopStrategy` = dar runtime a `@MainLoop strategy:'react'` + `AgentRunner` — [x] (shipped @theokit/agents@0.7.0)
**Esforço:** L · **Padrão:** Builder + Strategy · **Depende de:** V4-B, **V3-4** · **Valor:** ALTO
Implementa o `strategy:'react'` (hoje metadata-only) como loop multi-round real, substituindo o single-shot do `agent-orchestrator.ts`. O outer loop de 470 LoC do theocode (`agent-stream.ts`) vira `AgentRunner` configurado sobre o continuation driver do V3-4 (streaming+stateless). `LoopStrategy` = terminais (`done`/`step_limit`/`no_progress`) + re-prompt bounded + honra `maxIterations` (hoje compilado e ignorado). **Loop:** theocode troca `agent-stream.ts` por `AgentRunner.builder(...)`.

### V4-E — `GuardStrategy` + `@Guard` — [ ]
**Esforço:** M · **Padrão:** Strategy · **Depende de:** V4-B, **V3-1** · **Valor:** Alto
Permissões/guards declaráveis e swappáveis. Defaults usam o `catastrophicShellReason` endurecido do V3-1. **Loop:** theocode declara `@Guard([ShellGuard, ReadOnlyGuard])`; `permission.plugin.ts` + `shell-guard.ts` viram strategies.

### V4-F — `CompactionStrategy` + `@Compaction` — [ ]
**Esforço:** S · **Padrão:** Strategy · **Depende de:** V4-B, **V3-3** · **Valor:** Médio
Hoje só existe o knob `@ContextWindow`. Promover a strategy nomeada (`'token-budget'` usa o `compactTranscript` do V3-3). **Loop:** theocode usa `.compaction('token-budget')`; `compaction.ts` (150) some.

### V4-G — `ContextProvider` strategy (estende `@ProjectContext`) — [ ]
**Esforço:** M · **Padrão:** Strategy (chain) · **Depende de:** V4-B · **Valor:** Médio
O `@ProjectContext` já existe como knob; promover a providers encadeáveis (`project files`, `git state`). **Loop:** theocode `project-context.ts` (217) vira providers nomeados.

### V4-H — Starters (Spring Boot starters) — [ ]
**Esforço:** M · **Padrão:** Auto-config/Facade · **Depende de:** V4-B..V4-F · **Valor:** ALTO (adoção em massa)
`@theokit/starter-code-agent`: bundle opinativo (reflection ladder + shell guard + compaction) em <10 LoC. **Loop:** o theocode poderia ser reescrito sobre o starter (prova máxima).

### V4-I — Eval builder — [ ]
**Esforço:** M · **Padrão:** Builder · **Depende de:** V4-B, **V3-5** · **Valor:** Baixo-Médio
`EvalBuilder.create().dataset().scorer().build()` sobre o eval ergonômico do V3-5. **Loop:** theocode `eval-suite.ts`/`swebench-*`.

---

## 5. theocode vs theokit — padrões claros

| Conceito | `@theokit/sdk` (Harness) | `@theokit/agents` (authoring) | `theocode` (prova) |
|---|---|---|---|
| Tool/Agent | `defineTool`/`Agent.create` | ✅ `@Tool`/`@Agent` | declara |
| Reflection | — | `ReflectionStrategy`+`'ladder'` (**V4-C**) | `@Reflection('ladder')` |
| Loop | continuation driver (V3-4) | `AgentRunner`+`LoopStrategy` (**V4-D**) | `AgentRunner.builder(...)` |
| Guard | `catastrophicShellReason` (V3-1) | `GuardStrategy` (**V4-E**) | `@Guard([ShellGuard])` |
| Compaction | `compactTranscript` (V3-3) | `CompactionStrategy` (**V4-F**) | `.compaction('token-budget')` |
| Starter | — | `@theokit/starter-code-agent` (**V4-H**) | construído sobre |

Regra de ouro: `@theokit/agents` provê interface + default; `theocode` provê implementação só quando o domínio difere; tudo compila para o factory core do SDK (que nunca sabe da camada).

---

## 6. Definição de "V4 completa"

- [ ] V4-A: documento honesto do gap de adoção (cobre declaração, falta orquestração).
- [ ] V4-B..V4-F: builder + 4 strategies nomeadas; os ~720 LoC de orquestração do theocode colapsam para ~40 + strategies.
- [ ] **O theocode ADOTA o `@theokit/agents`** (a prova que faltava — o app de referência para de evitá-lo).
- [ ] V4-H: ≥1 starter funcional em <10 LoC.
- [ ] Claim reescrita: "construir um agente no theokit é declarativo e legível — `@Agent`/`@Tool`/`@Reflection`/`@Guard` para declarar, `AgentRunner.builder()` para compor, strategies nomeadas para variar, tudo compilando para um core factory testado — e o theocode prova adotando."

---

## 7. Riscos honestos

| Risco | Sev. | Mitigação |
|---|---|---|
| **Repetir o erro da v1** (planejar sobre suposição) | **Alta** | V4-A (diagnóstico empírico) é o gate; nada se constrói antes de medir o gap real. |
| O gap de adoção NÃO ser falta de feature (ser DX/maturidade/`reflect-metadata` friction) | **Alta** | V4-A pode concluir que o problema é outro — então o V4 muda de "estender" para "consertar". Honestidade > momentum. |
| Over-abstração (strategies que ninguém entende — KISS) | Alta | Regra de 3: só promove strategy com ≥2 implementações reais. Default sempre presente. |
| `reflect-metadata`/Legacy decorators friction | Média | É a escolha estabelecida (Pattern D1); custo ~3KB opt-in; não rebrigar. |
| Concorrer com o on-ramp imperativo | Média | "Três sintaxes, um runtime" — açúcar, não fork. Imperativo segue canônico. |

---

## 8. Prior art — narrow (só a parte aberta: builder/strategy/starter)

O decorator-foundation já está in-repo, então a pesquisa externa foca só no que é novo:

| Framework | Stack | O que estudar (builder/strategy/starter) |
|---|---|---|
| **Spring AI** | Java | `ChatClient.builder()` (builder) + Advisors (strategy) + starters opinativos |
| **a peer framework** | **TypeScript** | config-object + workflow graph (strategy em TS sem decorator) — a prova de DX em TS |

Insight: o `@theokit/agents` já tem o que a peer project/LlamaIndex/Semantic-Kernel dariam (decorators→runtime). O que falta (builder fluente + strategies nomeadas) é o forte do **Spring AI** (builder+advisor+starter) e do **a peer framework** (strategy tipada em TS). Discovery narrow nesses dois.

---

## 9. Como executar

```
✅ V4-A diagnóstico (in-repo) ......... FEITO → gap = @MainLoop metadata-only
✅ /discover (cycle completo) ......... FEITO → blueprint SHIPPABLE (99.0)
        ↓
   V4-B..V4-F: por milestone, /to-plan → ... → /implement → /review (em @theokit/agents)
        → release → theocode adota → mede LoC/legibilidade/adoção
```

### Discovery concluído (2026-06-23) — decisões fixadas com evidência

Cycle-discover inteiro rodado pelas skills reais (`theokit/.claude/knowledge-base/discoveries/blueprints/declarative-agent-orchestration-blueprint.md`, **SHIPPABLE 99.0**). Conclusões que ancoram V4-B..V4-D:

1. **`LoopStrategy` modela-se no a peer framework `agentic-loop`/`stopWhen` (multi-round), NÃO no Advisor do Spring** — o Advisor é interceptor per-call (middleware), não decide entre rounds (EC-4). Contrato proposto: `LoopStrategy.shouldContinue(outcome): boolean` + `maxIterations`.
2. **`ReflectionStrategy.reflect(outcome) → { feedback?, continue }`** — espelha o `onIterationComplete` do a peer framework.
3. **`AgentRunner.builder(AgentClass).reflection().compaction().stream().build()`** — e o builder do Spring (`DefaultChatClient`) prova que **builder + decorator coexistem standalone, sem IoC** (zero `@Autowired`) → valida a restrição ADR 0031.
4. **EC-2 pagou:** o `tool-loop-agent/` do a peer framework é adapter alpha (AI-SDK v6 interop), NÃO o loop canônico — o blueprint modelou sobre o `agentic-loop` canônico. Sem o cross-check, teríamos copiado um experimento.
5. Tudo compila do campo `@MainLoop({strategy})` → `Agent.create()`/`Run.stream()` (bridge compila, SDK executa, sem IoC — `sdk-runtime.md`/ADR 0031). Mecanismos Java/Spring marcados como não-portáveis (EC-3).

**Próximo:** `/to-plan` para V4-B (builder) + V4-C (`strategy:'plan-act-reflect'` runtime) em `theokit/packages/agents`, usando este blueprint como prior-art.

---

> **Sincronização:** manter em sincronia com a cópia top-level de `gap-audit/`. Canônico: `theokit-sdk/docs/gap-audit/ROADMAP-v4.md`.
> **Dependência cruzada:** V4-C..V4-F consomem primitivos do [`ROADMAP-v3`](./ROADMAP-v3.md) (V3-1/V3-3/V3-4/V3-5). V3 endurece; V4 embrulha declarativamente.
> **Histórico:** v1 (2026-06-23) assumia greenfield; revisão 2 corrigiu após ler `@theokit/agents@0.5.0` + ADR 0031.
