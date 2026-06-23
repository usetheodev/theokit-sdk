# ROADMAP-v4 — Declarative Agent Authoring (decorators + builders, o jeito TheoKit)

> **Status:** PROPOSTO (2026-06-23). Iniciativa estratégica nova — uma **camada de autoria declarativa** sobre o core factory. Reabre a postura do ADR D431 (de forma controlada) e exige um ADR de ratificação antes de qualquer código. Escopo primário: `theokit` (framework) + `@theokit/di-agent` (ou novo `@theokit/authoring`). Prova: `theocode`.
> Irmão de [`ROADMAP-v2.md`](./ROADMAP-v2.md) (adoção) e [`ROADMAP-v3.md`](./ROADMAP-v3.md) (hardening de framework). O V4 é a camada de **DX/autoria**: tornar a construção de agentes tão legível e simples quanto montar um app Spring Boot.

---

## 0. Premissa e decisão estratégica

### 0.1 O problema

Hoje, construir um agente sério no stack (provado pelo `theocode`) ainda exige escrever **~3.000 LoC de plumbing imperativo** em `server/lib/`. Os maiores hand-rolls — `agent-stream.ts` (470), `agent-loop.ts`/reflection ladder (248), `compaction.ts` (150), `shell-guard.ts` (143) — são **lógica de orquestração e política** que se repete em qualquer agente sério. Não há padrão claro, nomeável e reutilizável. Um recém-chegado lê 470 linhas para entender "o que esse agente faz".

A claim "o theokit simplifica construir agentes" é verdadeira para o **core single-turn** (providers, tools, streaming, retry) — mas **falsa para a orquestração**: o loop, a reflexão, os guards, a compaction são DIY. **Essa é a oportunidade.**

### 0.2 A decisão (e o que aprendemos com o D431)

O **ADR D431 (2026-06-18)** revogou "decorators obrigatórios via `@theokit/di`" — porque forçava o **Harness a shipar um IoC container genérico** e puxou scope creep (`di → di-agent → orm → http-decorators`), ferindo Rule 9 + KISS + YAGNI. O **ADR 0032** locked: factory-first canônico; `di/orm` externos + opt-in.

**O V4 NÃO reverte o D431. Ele honra a lição e reabre só a parte segura:**

> Decorators e builders são **AÇÚCAR DE TEMPO-DE-CARGA que compila para as factory calls do `@theokit/sdk`**. Não há IoC container, não há `reflect-metadata`, não há injeção por tipo. O Harness permanece factory-first e **nunca importa a camada declarativa**. A camada vive no `theokit`; é 100% opt-in; o `theocode` a prova.

Isso é exatamente o que o Spring faz bem: `@Bean` e o registro programático produzem o mesmo bean. A diferença para a tentativa anterior: **a tentativa anterior pôs o container no núcleo; o V4 põe só um assembler fino na camada de framework.**

**Esta postura exige um ADR de ratificação (V4-0) antes de qualquer código.** A regra 9 do `theokit-sdk/CLAUDE.md` precisa de uma nota: "decorators permitidos como sugar opt-in que compila para factories; Harness segue independente."

### 0.3 O loop de prova (dogfooding)

Idêntico ao V2/V3: cada milestone shipa um primitivo declarativo no `theokit` → **o `theocode` refatora o hand-roll equivalente para usá-lo** → mede-se a redução de LoC + legibilidade. Se o `theocode` não adotar (como hoje rejeita os `@Agent`/`@Tool` atuais), o primitivo **não é bom o suficiente** — e o roadmap diz por quê.

---

## 1. Princípios de design (os "padrões claros" que você pediu)

A camada inteira segue **4 papéis, um runtime**:

| Papel | Mecanismo | Padrão GoF | Exemplo |
|---|---|---|---|
| **DECLARAR** o quê | Decorator | — | `@Tool`, `@Agent`, `@Guard` |
| **CONSTRUIR / compor** | Builder fluente | Builder | `AgentRunner.builder()...` |
| **VARIAR comportamento** | Strategy nomeada | Strategy | `ReflectionStrategy`, `CompactionStrategy` |
| **EXECUTAR** | Factory do SDK | Factory | `Agent.create`, `defineTool` |

**Invariante "três sintaxes, um runtime"** — toda capacidade é expressável das 3 formas, e as 3 produzem o MESMO resultado de factory:

```ts
// 1. Decorator (declarativo, Spring-like)
@Tool({ name: 'read_file', schema: ReadSchema })
class ReadFile { async run(p) { /* ... */ } }

// 2. Builder (fluente)
const readFile = ToolBuilder.create('read_file').schema(ReadSchema).run(fn).build();

// 3. Factory (o que ambos compilam — o SDK de hoje, intocado)
const readFile = defineTool({ name: 'read_file', schema: ReadSchema, run: fn });
```

**Restrições inquebráveis (o que mantém isso simples e fora da armadilha do D431):**

1. **Sem IoC container.** Decorators só coletam metadata num registry leve; um assembler fino monta a factory call. Nada de `ApplicationContext`.
2. **Sem `reflect-metadata` / sem injeção por tipo.** Args sempre explícitos (`@Tool({ schema })`, não inferência por tipo do parâmetro). Usa decorators TC39 (Stage 3, nativo no TS 5.x).
3. **Harness independente.** `@theokit/sdk` nunca importa a camada de autoria. A dependência é unidirecional: `theokit (authoring) → @theokit/sdk (factories)`.
4. **Strategy = interface + factory + default.** O `theokit` define a interface e uma implementação default; o `theocode` (ou qualquer app) provê a implementação de domínio só quando difere. Sem mágica de resolução.
5. **Opt-in total.** O on-ramp imperativo (factory) continua canônico e suportado para sempre. Decorators são para quem quer legibilidade; builders para quem quer composição programática.

---

## 2. O headline: antes vs depois (o `theocode`)

**HOJE** (imperativo, espalhado por `agent-stream.ts` 470 + `agent-loop.ts` 248 + `tools/` + `config-loader.ts`):

```ts
const agent = await Agent.create({
  model, instructions: codePrompt,
  tools: toolsForMode(cwd),
  plugins: [codePermissionPlugin],
  local: { cwd, settingSources: ['project'] },
});
// + ~720 LoC de outer loop à mão: streaming, classifyRoundOutcome,
//   reflection ladder, compaction, continuation history, no-progress detection...
```

**COM V4** (declarativo + builder + strategies — compila para o `Agent.create` acima):

```ts
@Agent({
  model: 'claude-opus-4-8',
  instructions: codePrompt,
  tools: [ReadTool, WriteTool, ShellTool],   // classes @Tool
  guards: [ShellGuard, ReadOnlyGuard],        // strategies @Guard (V3-1)
})
class CodeAgent {}

const runner = AgentRunner.builder(CodeAgent)
  .reflection('ladder')                                 // ReflectionStrategy nomeada
  .compaction('token-budget', { keepTokens: 8000 })     // CompactionStrategy (V3-3)
  .stream(true)                                         // LoopStrategy streaming (V3-4)
  .build();

for await (const event of runner.run(prompt, { cwd })) { /* ... */ }
```

Meta mensurável: as **~720 LoC de orquestração** do `theocode` viram **~40 LoC declarativas + N strategies nomeadas e testáveis isoladamente**. Um recém-chegado entende o agente em 30 segundos.

---

## 3. Sequência (dependency graph)

```
V4-0 (assembler core + ADR ratifica D431-revisit) ─── FUNDAÇÃO, bloqueia tudo
   │
   ├─ Tier 1 (MVP declarativo — prova a tese rápido)
   │     V4-1 @Tool+ToolBuilder ─▶ theocode tools/
   │     V4-2 @Agent+AgentBuilder ─▶ theocode agent decl.
   │
   ├─ Tier 2 (o payoff de legibilidade — os grandes hand-rolls colapsam)
   │     V4-3 @Guard+GuardStrategy        (depende V3-1 shell-guard)
   │     V4-4 @Reflection+ReflectionStrategy   ◀── maior ganho de leitura
   │     V4-5 AgentRunner+LoopStrategy     (depende V3-4 continuation)
   │
   ├─ Tier 3 (completude)
   │     V4-6 @Compaction (depende V3-3) · V4-7 @ContextProvider
   │     V4-8 @SubAgent/handoff · V4-9 @Memory/@Skill
   │
   └─ Tier 4 (adoção em massa)
         V4-10 Starters (Spring Boot starters) ◀── "qualquer um constrói"
         V4-11 @Eval+EvalBuilder (depende V3-5)
```

Ordem por valor: **V4-0 → Tier 1 (prova) → Tier 2 (wow) → Tier 3 → Tier 4 (escala).** Tier 2 consome os primitivos endurecidos do V3 — **V3 e V4 são complementares**: o V3 endurece o primitivo, o V4 o embrulha declarativamente.

---

## V4-0 — Assembler core + ADR de ratificação — [ ]

**Esforço:** M · **Repo:** `theokit` / decisão `@theokit/di-agent` vs novo `@theokit/authoring` · **Padrão:** Registry + Assembler · **Depende de:** — · **Valor:** FUNDAÇÃO

O coração que torna tudo possível **sem IoC**. Um registry leve (coleta metadata de decorators no load) + um assembler fino (metadata → factory call do SDK).

**Decisões deste milestone (ADR):**
1. **Reabrir a postura do D431** — registrar ADR: "decorators permitidos como sugar opt-in que compila para factories; Harness independente; sem IoC/sem reflect-metadata." Atualizar a Rule 9 do `theokit-sdk/CLAUDE.md` com a nota.
2. **`@theokit/di-agent` slim-down vs `@theokit/authoring` novo** — o `di-agent` atual carrega a bagagem IoC do scope creep. Avaliar: enxugar (remover o container, manter só decorators→factory) OU começar limpo. *(Provável: novo `@theokit/authoring` mínimo; deprecar o di-agent pesado.)*
3. **TC39 decorators, sem `reflect-metadata`** — provar num spike que `@Tool`/`@Agent` funcionam com args explícitos e TS 5.x stage-3, zero metadata reflection.

**Concluído quando:** spike prova decorator→factory sem IoC/sem reflect-metadata; ADR ratificado + Rule 9 atualizada; pacote-alvo decidido. **Loop:** —(é fundação).

---

## V4-1 — `@Tool` + `ToolBuilder` — [ ]

**Esforço:** S · **Repo:** `theokit` · **Padrão:** Factory sugar + Builder · **Depende de:** V4-0 · **Valor:** Alto (frequência)

Tools são o primitivo mais frequente e mais simples — começar por eles prova a tese com baixo risco. `@Tool({ name, schema, description })` numa classe/método → emite `defineTool`. `ToolBuilder.create()` fluente para composição programática.

**Spec executável:** `theocode/server/tools/index.ts` (`defineTool` x N) + `web-fetch-guard.ts` (tool com guard embutido).

**Concluído quando:** as 3 sintaxes produzem `defineTool` idêntico (teste de paridade). **Loop fechado:** o `theocode` converte `server/tools/index.ts` + `web-fetch-guard` para `@Tool`/`ToolBuilder`; mede-se legibilidade + LoC.

---

## V4-2 — `@Agent` + `AgentBuilder` — [ ]

**Esforço:** M · **Repo:** `theokit` · **Padrão:** Factory sugar + Builder · **Depende de:** V4-0, V4-1 · **Valor:** Alto

A declaração do agente. `@Agent({ model, instructions, tools, guards })` → `Agent.create`. `AgentBuilder` fluente. Resolve a referência a classes `@Tool` (sem IoC — o assembler resolve a lista explícita de classes para suas factory calls).

**Spec executável:** `theocode/server/lib/config-loader.ts` (`mapToAgentCreate`) + `agent-stream.ts` (montagem do `Agent.create`).

**Concluído quando:** `@Agent` + `AgentBuilder` compilam para `Agent.create` idêntico; paridade testada. **Loop fechado:** o `theocode` declara o code-agent com `@Agent` + `AgentBuilder`; a montagem imperativa em `config-loader`/`agent-stream` encolhe.

---

## V4-3 — `@Guard` + `GuardStrategy` (Strategy) — [ ]

**Esforço:** M · **Repo:** `theokit` · **Padrão:** Strategy · **Depende de:** V4-2, **V3-1** (shell-guard endurecido) · **Valor:** Alto (segurança legível)

Permissões e guards viram **strategies nomeadas e testáveis**. `@Guard(ShellGuard)` / `guards: [ShellGuard, ReadOnlyGuard]`. O `GuardStrategy` é interface + defaults (`ShellGuard` usa o `catastrophicShellReason` endurecido do V3-1; `ReadOnlyGuard` bloqueia escrita).

**Spec executável:** `theocode/server/agents/permission.plugin.ts` (codePermissionPlugin + readOnlyPermissionPlugin) + `shell-guard.ts`.

**Concluído quando:** guards declaráveis + swappáveis; defaults usam V3-1. **Loop fechado:** o `theocode` declara `guards: [...]` no `@Agent`; `permission.plugin` vira strategies nomeadas.

---

## V4-4 — `@Reflection` + `ReflectionStrategy` (Strategy) — [ ]

**Esforço:** M · **Repo:** `theokit` · **Padrão:** Strategy · **Depende de:** V4-2 · **Valor:** ALTO (maior ganho de leitura)

**O milestone-assinatura.** A reflection ladder de 248 LoC do `theocode` (reflect/verify/verify-fix por outcome de round) vira uma **`ReflectionStrategy` nomeada** (`'ladder'`, `'none'`, custom). O `theokit` provê a interface + a default `'ladder'`; apps com política própria implementam a interface.

**Spec executável:** `theocode/server/lib/agent-loop.ts` (`classifyRoundOutcome`, `selectReflection`).

**Concluído quando:** `ReflectionStrategy` com default `'ladder'` testável isoladamente; `.reflection('ladder')` no builder. **Loop fechado:** o `theocode` usa `.reflection('ladder')`; `agent-loop.ts` vira a implementação default da strategy no `theokit` (promovida de domínio para framework) OU fica como strategy custom se for específica demais.

---

## V4-5 — `AgentRunner` builder + `LoopStrategy` (Builder + Strategy) — [ ]

**Esforço:** L · **Repo:** `theokit` · **Padrão:** Builder + Strategy · **Depende de:** V4-4, **V3-4** (continuation driver streaming) · **Valor:** ALTO

O outer loop de 470 LoC vira um **runner configurado**. `AgentRunner.builder(CodeAgent).reflection().compaction().stream().build()` → roda sobre o continuation driver do V3-4 (streaming + stateless). `LoopStrategy` encapsula terminais (`done`/`step_limit`/`no_progress`) + re-prompt bounded.

**Spec executável:** `theocode/server/lib/agent-stream.ts` (`runCodeAgent`) + `continuation-history.ts`.

**Concluído quando:** `AgentRunner` emite `AsyncGenerator<AgentEvent>` sobre o driver V3-4; terminais via `LoopStrategy`. **Loop fechado:** o `theocode` substitui `agent-stream.ts` por `AgentRunner.builder(...)`; as ~470 LoC colapsam para ~40 + strategies.

---

## V4-6 — `@Compaction` + `CompactionStrategy` (Strategy) — [ ]

**Esforço:** S · **Repo:** `theokit` · **Padrão:** Strategy · **Depende de:** V4-5, **V3-3** (token-budget) · **Valor:** Médio

`.compaction('token-budget', { keepTokens })` → usa o `compactTranscript` endurecido do V3-3. `CompactionStrategy` nomeada (`'token-budget'`, `'turn-count'`, custom).

**Loop fechado:** o `theocode` usa `.compaction('token-budget')`; `compaction.ts` (150 LoC) some.

---

## V4-7 — `@ContextProvider` (Strategy/Builder) — [ ]

**Esforço:** M · **Repo:** `theokit` · **Padrão:** Strategy (chain) · **Depende de:** V4-2 · **Valor:** Médio

Injeção de contexto (project files, AGENTS.md, system info) vira providers declaráveis encadeáveis. `@ContextProvider` / `.context([ProjectFiles, GitState])`.

**Spec executável:** `theocode/server/lib/project-context.ts` (217 LoC).

**Loop fechado:** o `theocode` declara providers; `project-context` vira providers nomeados.

---

## V4-8 — `@SubAgent` + handoff builder — [ ]

**Esforço:** M · **Repo:** `theokit` · **Padrão:** Factory sugar + Builder · **Depende de:** V4-2 · **Valor:** Médio

Sub-agentes e handoffs declarativos. `@SubAgent` / `.handoffs([ExploreAgent])`. Compila para o suporte de subagents do SDK.

**Spec executável:** o explore-agent do `theocode` (`tool-catalog.ts` + agents/).

---

## V4-9 — `@Memory` + `@Skill` (config declarativa) — [ ]

**Esforço:** S · **Repo:** `theokit` · **Padrão:** Factory sugar · **Depende de:** V4-2 · **Valor:** Médio

Memória e skills via decorator de config. `@Memory({ backend, activeRecall })` / `@Skill`. Compila para o config de `Agent.create`.

**Spec executável:** `theocode/server/lib/memory-store.ts` + `skills-store.ts`.

---

## V4-10 — Starters (Spring Boot starters) — [ ]

**Esforço:** M · **Repo:** `theokit` (novos `@theokit/starter-*`) · **Padrão:** Auto-config / Facade · **Depende de:** Tier 1+2 · **Valor:** ALTO (adoção em massa)

**O capstone de "qualquer pessoa constrói facilmente".** Bundles opinativos, à la Spring Boot starters: `npm i @theokit/starter-code-agent` entrega um code-agent funcional pré-configurado (reflection ladder + shell guard + compaction token-budget + tools de código). O dev sobrescreve só o que quer.

```ts
import { CodeAgentStarter } from '@theokit/starter-code-agent';
const runner = CodeAgentStarter.builder().instructions(myPrompt).build();  // pronto
```

**Concluído quando:** ≥1 starter (`code-agent`) shipa um agente funcional em <10 LoC; documentado. **Loop fechado:** o `theocode` poderia ser reescrito sobre o starter (prova máxima — o app de referência cabe num starter + domínio).

---

## V4-11 — `@Eval` + `EvalBuilder` — [ ]

**Esforço:** M · **Repo:** `theokit` · **Padrão:** Builder · **Depende de:** V4-2, **V3-5** (eval ergonomics) · **Valor:** Baixo-Médio

Harness de avaliação declarativo. `@Eval` / `EvalBuilder.create().dataset().scorer().build()`. Sobre o eval ergonômico do V3-5.

**Spec executável:** `theocode/server/lib/eval-suite.ts` + `swebench-*`.

---

## 4. theocode vs theokit — padrões claros (a fronteira)

| Conceito | `@theokit/sdk` (Harness) | `theokit` (framework / authoring) | `theocode` (app de referência) |
|---|---|---|---|
| Tool | `defineTool` (factory) | `@Tool` / `ToolBuilder` | declara suas tools de código com `@Tool` |
| Agent | `Agent.create` (factory) | `@Agent` / `AgentBuilder` | declara o `CodeAgent` |
| Reflection | — | `ReflectionStrategy` + default `'ladder'` | usa `'ladder'` (ou custom de domínio) |
| Loop | continuation driver (V3-4) | `AgentRunner` + `LoopStrategy` | `AgentRunner.builder(...)` |
| Guard | `catastrophicShellReason` (V3-1) | `GuardStrategy` + defaults | declara `guards: [ShellGuard]` |
| Compaction | `compactTranscript` (V3-3) | `CompactionStrategy` | `.compaction('token-budget')` |
| Starter | — | `@theokit/starter-code-agent` | (poderia ser construído sobre ele) |

**Regra de ouro do boundary:** o `theokit` provê **interface + default** de cada strategy; o `theocode` provê **implementação só quando o domínio genuinamente difere**. Tudo compila para o factory core do `@theokit/sdk`, que **nunca** sabe que a camada declarativa existe.

---

## 5. Definição de "V4 completa"

- [ ] V4-0: ADR ratifica decorators-como-sugar; spike prova sem IoC/sem reflect-metadata; pacote decidido.
- [ ] Tier 1 (V4-1, V4-2): um recém-chegado declara agente + tools declarativamente; theocode adota tools + agent decl.
- [ ] Tier 2 (V4-3, V4-4, V4-5): os ~720 LoC de orquestração do theocode colapsam para ~40 LoC + strategies nomeadas; legibilidade comprovada.
- [ ] Tier 3 (V4-6..V4-9): compaction/context/subagent/memory declaráveis; theocode adota.
- [ ] Tier 4 (V4-10, V4-11): ≥1 starter funcional em <10 LoC; eval declarativo.
- [ ] **Métrica de prova:** `server/lib/` do theocode encolhe de ~2.977 LoC para majoritariamente **domínio puro** (sem plumbing de orquestração). Um agente novo de exemplo é construível em <30 LoC declarativas.
- [ ] **Claim reescrita:** "o theokit torna a construção de agentes declarativa e legível — decorators para declarar, builders para compor, strategies nomeadas para variar, tudo compilando para um core factory testado — e o theocode prova com -90% de plumbing de orquestração."

---

## 6. Riscos honestos a vigiar

| Risco | Severidade | Mitigação |
|---|---|---|
| **Repetir o D431** (camada declarativa vira IoC container no núcleo) | **Alta** | Restrição inquebrável #1-3: sugar→factory, sem IoC, sem reflect-metadata, Harness independente. V4-0 prova isso num spike ANTES de qualquer feature. |
| Over-abstração (strategies/decorators que ninguém entende — fere KISS) | Alta | Regra de 3: só promove strategy quando há ≥2 implementações reais (theocode + ≥1). Default sempre presente; opt-in sempre. |
| Decorators TC39 instáveis / pegadinhas de TS | Média | V4-0 valida stage-3 no TS pinado; sem `reflect-metadata`; args explícitos evitam a parte instável (metadata de tipo). |
| O próprio theocode rejeitar de novo (como rejeita o di-agent hoje) | Média | Cada milestone fecha o loop NO MESMO ciclo; se o theocode não adotar, o primitivo é reprovado e o roadmap diz por quê. |
| Concorrer com o on-ramp imperativo (fragmentar a API) | Média | "Três sintaxes, um runtime" — não é fork, é açúcar. O imperativo segue canônico e suportado para sempre. |
| Escopo gigante (12 milestones) | Média | Tiers: Tier 1+2 já provam a tese e entregam o WOW; Tier 3+4 são incrementais e deferíveis. |

---

## 7. Prior art — quem resolve isso e o que pegamos/rejeitamos

| Framework | Stack | O que pegar | O que rejeitar |
|---|---|---|---|
| **Spring AI** | Java | starters opinativos; `@`-declaração + builders coexistindo; auto-config | annotations por reflection de tipo (não cabe no nosso "sem reflect-metadata") |
| **Microsoft Semantic Kernel** | .NET/Py | plugins como unidade declarativa; `[KernelFunction]` | container/kernel pesado |
| **CrewAI** | Python | legibilidade de `@agent`/`@task`; role-based | acoplamento ao runtime deles |
| **LlamaIndex Workflows** | Python | `@step` event-driven (inspiração p/ `LoopStrategy`) | event bus completo (YAGNI hoje) |
| **Mastra** | **TypeScript** | **a prova de que DX excelente em TS é possível**; config-object tipado + workflow graph | é config-object puro (sem decorators) — nós combinamos os dois |

**Insight decisivo:** decorator-declarativo domina em Java/.NET/Python (annotation cultural + reflection nativa). Em TS, o líder (Mastra) é config-object. **A aposta do V4 é combinar os dois** (decorator para declarar + builder/config para compor), evitando a parte do TS que dói (reflect-metadata/IoC). É um espaço genuinamente aberto — ninguém domina o slot "NestJS dos agentes" em TS.

---

## 8. Como executar (discover-first — obrigatório)

Porque o V4 reabre uma decisão estratégica (D431) e já queimamos escopo uma vez, o **primeiro passo é um `/discover`**, não código:

```
/discover-plan declarative-agent-authoring
   — pergunta central: "Qual a forma de autoria declarativa (decorator + builder)
     que maximiza legibilidade/manutenção p/ agentes em TS, compilando para o
     factory core, SEM IoC e SEM reflect-metadata (respeitando D431)?"
   — refs a clonar: spring-ai, semantic-kernel, mastra, llamaindex (workflows), crewai
   — produz blueprint → vira ADR de V4-0
        ↓
V4-0 (ADR ratifica + spike) → Tier 1 → Tier 2 → ...
   cada milestone: /to-plan → ... → /implement → /review (no theokit)
        → release → theocode adota de volta (cycle no theocode) → mede LoC/legibilidade
```

FAANG-level, sem workarounds, sem reinventar IoC. Só parar quando READY_TO_MERGE + loop fechado + métrica de redução comprovada.

---

> **Sincronização:** manter em sincronia com a cópia top-level de `gap-audit/` (mesma regra do ROADMAP-v2/v3). Versão canônica: `theokit-sdk/docs/gap-audit/ROADMAP-v4.md`.
> **Dependência cruzada:** os milestones Tier 2 consomem primitivos do [`ROADMAP-v3.md`](./ROADMAP-v3.md) (V3-1 shell, V3-3 compaction, V3-4 continuation, V3-5 eval). V3 endurece; V4 embrulha.
