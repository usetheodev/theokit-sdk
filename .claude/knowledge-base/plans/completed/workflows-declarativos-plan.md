# Plan: Workflows declarativos (`Workflow.create` / `.run`)

> **Version 1.2 — ✅ COMPLETE 2026-05-22.** TODAS AS TASKS, CRITERIOS DE ACEITES, DODs CONCLUIDAS E VALIDADAS, TESTE DOGFOOD TELEGRAM-PRO. Final dogfood: **43/44 PASS, 0 FAIL, 1 SKIP** (HONCHO_API_KEY unset, expected). `/workflow_demo` PASS in 6555ms; SDK tests 38/38 PASS; build ESM+CJS+DTS green; 19 ADRs registered (D230-D248); 5 MUST FIX edges absorbed + 5 SHOULD TEST validated via unit tests.
>
> **Version 1.1** — Edge case review 2026-05-22 absorved 5 MUST FIX (EC-1 abort-at-entry, EC-2 predicate throw, EC-3 maxAttempts Zod min, EC-4 non-serializable snapshot, EC-5 workflowId in lock key) + 5 SHOULD TEST added to TDD blocks. See `.claude/knowledge-base/reviews/edge-case/workflows-declarativos-edge-cases-2026-05-22.md` for full review.
>
> **Version 1.0** — Adiciona ao `@theokit/sdk` uma primitiva de orquestração multi-step declarativa que compõe sobre `Agent.send`, `Handoff` (D214-D229) e `Agent.batch` (D134-D140), preenchendo o gap de paridade competitiva vs Mastra workflows e Inngest. API alvo: `Workflow.create({ id, input, steps }).then(stepA).parallel([b, c]).branch(...).commit()` + `.run(input, { signal })`. Persistência de snapshots em-memória por default (opt-in para JSON via `internal/persistence/`), suspend/resume nativo, retry policy declarativo por step (Temporal-shape), zero overhead operacional (sem cluster, sem worker pool). Outcome esperado: shippar o item #5 do Adoption Roadmap com ADRs D230-D248 + integração ao telegram-pro (`/workflow_demo`) + cobertura via dogfood.

## Context

**O que existe hoje** (mapeado da exploração feita em `packages/sdk/src/`):

- `Agent.send(prompt)` — single-turn imperativo, retorna `Run`.
- `Agent.runUntil(goal)` — loop com judge LLM e `AsyncGenerator<GoalEvent>` (D116-D122). Encerra por verdict; **não** declara grafo.
- `Agent.batch(prompts, options)` — N prompts em paralelo com semáforo in-house (D134-D140). Default concurrency 4; failure isolation per-prompt; `AbortSignal` cancela pending only.
- `Handoff.create(target, opts)` + `Agent.create({ handoffs: [other] })` (D214-D229) — delegação dinâmica LLM-driven entre agentes pares via synthetic `transfer_to_<name>` tools.
- `Agent.fork(opts)` (D110-D114) — clona o agente com tool whitelist via AsyncLocalStorage; usado por subagent dispatch.
- `Eval.create({ dataset, scorers, agent }).run()` (D202-D213) — façade estática que consome `Agent.batch` para paralelismo; per-row isolation; OTel spans via `internal/eval/telemetry.ts`.
- `internal/persistence/` (D59-D64) — primitivas de cross-cutting state: `atomicWriteJson`, `replaceFileAtomic`, `withFileLock`, `casUpdate`, `applyWalWithFallback`, `readVersionedJson`/`writeVersionedJson`, `getTheokitHome`.
- `internal/telemetry/` — wrapper lazy de `@opentelemetry/api` (D34); spans `eval.run`, `handoff.transfer` já demonstram o padrão.

**O que está faltando (gap real do roadmap):**

Hoje, qualquer cliente que precisa orquestrar pipeline multi-step (refund pipeline, content moderation com K classifiers em paralelo, retrieval com fan-out → rerank → summarize, onboarding de N etapas) escreve TS imperativo com try/catch manual. Mastra, Inngest, LangGraph e Temporal entregam isso como primitive de primeira classe. Sem `Workflow`, o gargalo competitivo do SDK desloca-se de "primitivos de agente" para "orquestração de agentes" — onde Mastra está ganhando adoção 2025-2026.

**Evidências da pesquisa web** (relatório completo em conversa prévia, ~800 linhas):

1. **Mastra workflows v1 beta** (GA jan/2026) — builder fluente `createWorkflow().then().parallel().branch().dountil().foreach().commit()` com Zod `inputSchema`/`outputSchema` por step e suspend/resume em LibSQL. **Blueprint API-wise para este plano.**
2. **Inngest** (durable functions, single-binary self-host Apache-2.0) — modelo "re-execute-and-skip" com step memoization determinística via ID. **Blueprint para persistence semantics**, mas HTTP-per-step é overkill para SDK in-process.
3. **LangGraph.js** — modelo grafo (StateGraph + nodes + edges + reducers por chave). **Não-blueprint** — overhead conceitual para o caso pipeline 90%; só viraria opção se quiséssemos state-machine.
4. **Temporal TS SDK** — durable execution com sandbox determinístico + `proxyActivities` + saga LIFO manual. **Não-blueprint operacional** (cluster Postgres exigido), **blueprint semântico** para retry policy e saga.
5. **OpenAI Agents SDK** — só `Runner.run` + handoffs, **sem workflow declarativo** (gap conhecido; recomendam integrar Temporal).
6. **Vercel AI SDK 6** — só `streamText` + `ToolLoopAgent`, sem workflow. Confirma o gap.
7. **CrewAI tasks** — autônomo (LLM decide), filosoficamente o oposto. Antipattern para workflows determinísticos.
8. **Saga/compensation** — apenas Temporal tem como primitive (e mesmo assim só Java SDK). **Oportunidade de diferenciação** se shipparmos `step.compensate?` opt-in.

**Por que NOW, não LATER:**

- Adoption Roadmap #4 (handoffs) shipou 2026-05-22 — workflows compõem naturalmente sobre handoffs (workflow chama agentes que podem fazer handoff internamente).
- `Agent.batch` (D134) e `internal/persistence/` (D59-D64) são prerequisites que **já existem**. Sem refactor invasivo.
- 5 itens restantes no Adoption Roadmap; #5 tem score 7 (segundo mais alto entre os pendentes, atrás só de #3 Docs).
- Pressão competitiva: Mastra v1 GA em jan/2026 vai mover a barra. Shipping antes mantém paridade.

## Objective

**Done = `Workflow.create({...}).then(...).parallel(...).branch(...).commit().run(input)` produz `WorkflowRun` em produção, com suspend/resume, retry declarativo, telemetry OTel e integração validada no telegram-pro via `/workflow_demo`.**

Goals mensuráveis:

1. 7 control-flow primitives shipados: `.then`, `.parallel`, `.branch`, `.foreach`, `.dowhile`, `.sleep`, `.suspend` (saga `.compensate` deferido para v1.2).
2. Public API estável tipada via Zod schemas por step (input/output propagados pelo builder).
3. Snapshots em-memória por default; opt-in via `persistence: { backend: "json", dir }` para retomada após crash.
4. Retry policy declarativo: `{ maxAttempts, backoffMs, backoffCoefficient, nonRetryableErrors }`.
5. Telemetry: spans `workflow.run`, `workflow.step.<id>`, atributos `step.attempt`, `step.status`.
6. Cobertura: ≥40 unit tests novos + 1 example (`examples/workflows/`) + `/workflow_demo` no telegram-pro.
7. ADRs registradas: D230-D248 (19 ADRs) — coerentes com padrão estabelecido (D202-D229 do Eval + Handoff).
8. Dogfood telegram-pro: ≥41/44 PASS (target: 100% após adicionar `/workflow_demo`).
9. **CloudAgent.runWorkflow é fora de escopo** — workflows ride only in `LocalAgent` por v1 (consistência com `runUntil` D122).

## ADRs

### D230 — `Workflow` é classe estática com `Workflow.create({...})` factory + `.run()` method

**Decision:** `Workflow` segue o mesmo padrão das outras façades públicas (`Agent.create`, `Eval.create`, `Handoff.create`, `Cron.create`): classe com private constructor e factory estática. `.create()` valida options via Zod parse e retorna `WorkflowBuilder` (mutable chain); `.commit()` no final retorna `Workflow` imutável; `.run(input, opts?)` retorna `Promise<WorkflowRun>`.

**Rationale:** Padrão estabelecido em 6 façades públicas — quebrar consistência custaria 5 PRs para padronizar depois. `.commit()` no fim é a única concessão a Mastra (precisamos do builder mutável durante DSL chain para preservar tipos).

**Consequences:** Type-test simples (`expectError<WorkflowBuilder>(w.run())`). Builder não é importável diretamente — só via `Workflow.create()`. Imutável após commit (sem `addStep` post-commit).

### D231 — Builder fluente é **mutável internamente** + retorna `Workflow` imutável após `.commit()`

**Decision:** Os métodos chainable (`.then`, `.parallel`, etc) mutam um array `steps[]` interno e retornam `this`. `.commit()` clona o estado, valida grafo (detecta steps duplicados, refs órfãs) e retorna `Workflow` imutável.

**Rationale:** Mastra usa este pattern (`.commit()` é familiar pra desenvolvedores migrando). Type inference funciona em chain mutável — se cada `.then` retornasse novo Builder com tipos refinados, a recursão de tipos explodiria.

**Consequences:** Workflows não são forkáveis post-commit (precisa novo `Workflow.create`). Tests podem inspecionar `builder.steps` para verificar ordem. Sem benefícios de imutabilidade durante DSL phase — aceitável porque DSL é construction-time.

### D232 — `Step` é discriminated union por `kind: "agent" | "fn" | "parallel" | "branch" | "foreach" | "dowhile" | "sleep" | "suspend"`

**Decision:** Internalmente cada primitive adiciona um node tipado:
- `kind: "fn"` — `{ id, fn, retry?, compensate? }`
- `kind: "agent"` — `{ id, agent, promptTemplate, retry? }`
- `kind: "parallel"` — `{ id, branches: Step[][], concurrency? }`
- `kind: "branch"` — `{ id, predicates: Array<[fn, Step[]]>, fallback?: Step[] }`
- `kind: "foreach"` — `{ id, iterableFrom: stepId, step: Step, concurrency? }`
- `kind: "dowhile"` — `{ id, step: Step, condFn, maxIterations: 100 }`
- `kind: "sleep"` — `{ id, durationMs }`
- `kind: "suspend"` — `{ id, payloadSchema?: ZodType }`

**Rationale:** Discriminated unions encaixam no padrão do SDK (`Plugin` D98, `GoalEvent` D115, `SDKMessage`). Cada step.kind tem campos diferentes — union evita interface "wide" com 12 optionals.

**Consequences:** Switch exhaustivo no executor (TypeScript força handling de todos os kinds). Adicionar novo kind = mudar discriminator + 1 case no switch (não viral). Tests podem snapshot por kind.

### D233 — Control flow primitives copiam nomes Mastra: `.then`, `.parallel`, `.branch`, `.foreach`, `.dowhile`, `.sleep`, `.suspend`

**Decision:** Adopt Mastra naming exato. Não inventar nomes — DX vence sobre originalidade. `.commit()` no fim é o trigger imutável.

**Rationale:** Mastra é a referência mais alinhada (TS-first, Zod-driven, GA jan/2026). Reusar nomes facilita migração e busca docs. Alternativas (`step`, `sequence`, `do`, `if`/`else`) foram consideradas e rejeitadas — menos descritivas.

**Consequences:** Quem leu docs Mastra entende este SDK em 5 minutos. Update docs.md com seção "Workflows" que cita Mastra como inspiração. Diferenças (state model, persistence) destacadas explicitamente.

### D234 — Estado entre steps é **explicit input/output**, NÃO state-machine global

**Decision:** Cada step recebe o `output` do step anterior como `input` (ou objeto agregado se for `.parallel` / `.branch`). NÃO há state global compartilhado (vs LangGraph `Annotation.Root + reducers`).

**Rationale:** Pipeline-shape é o caso 90%. State-machine global (LangGraph) é mais poderoso mas exige modelo mental de reducers que confunde 80% dos consumidores. Se algum dia precisarmos de state global, adicionamos `ctx.state` opt-in sem quebrar API.

**Consequences:** Workflow é puramente funcional na superfície — `(input) => output` por step. Tests são simples (assert output dado input). State implícito (ex: workflow-wide config) sai por closure no `Workflow.create` scope.

### D235 — Persistence default é **in-memory**; JSON opt-in via `persistence: { backend: "json", dir }`

**Decision:** Default zero-config: snapshots vivem em `Map<runId, WorkflowSnapshot>` no processo. Opt-in para JSON file via `Workflow.create({..., persistence: { backend: "json", dir: ".theokit/workflows" } })` — usa `atomicWriteJson` + `readVersionedJson` do `internal/persistence/`.

**Rationale:** Maioria dos workflows roda in-process e morre com o processo (test runs, ad-hoc tasks). Forçar disk write seria DX killer. JSON é opt-in porque é a complexidade que paga (resume após crash). SQLite/Postgres backends ficam pra v1.1 + adapter pattern (mesmo formato D143).

**Consequences:** `Workflow.resume({ runId })` falha com `WorkflowSnapshotNotFoundError` se persistence não estiver configurada e o processo restartar. Documentar bem. Backend abstração via interface `WorkflowSnapshotStore` para extensibilidade.

### D236 — Suspend/resume via `await ctx.suspend(payload?)` → `Workflow.resume({ runId, stepId, payload? })`

**Decision:** Step pode chamar `await ctx.suspend()` dentro do `fn` para pausar o workflow. Engine serializa estado, persiste snapshot, retorna `WorkflowRun` com `status: "suspended"`. Caller chama `Workflow.resume({ runId, stepId, payload })` para retomar. Payload validado por `payloadSchema` se definido.

**Rationale:** Mastra pattern, validado em produção. Encaixa em casos human-in-the-loop, retry com cooldown, esperar evento externo. `kind: "suspend"` standalone step também existe para suspends explícitos sem fn associado.

**Consequences:** Engine precisa serialização do `WorkflowSnapshot` (Zod schema versioning via `readVersionedJson`). Steps que dependem de closures locais não-serializáveis precisam de marker (`isResumable?: false`). Documentar limitação.

### D237 — Retry policy declarativo per-step, Temporal-shape: `retry: { maxAttempts, initialBackoffMs, backoffCoefficient, nonRetryableErrors? }`

**Decision:** Cada `kind: "fn" | "agent"` aceita `retry: {...}` opcional. Defaults: `maxAttempts: 1` (sem retry), `initialBackoffMs: 1000`, `backoffCoefficient: 2.0`, `nonRetryableErrors: ["WorkflowSnapshotNotFoundError", "AbortError", "ConfigurationError"]`.

**Rationale:** Temporal validou esse shape em produção. Mais expressivo que Mastra (que delega retry para o runner). Lista de erros não-retentáveis evita loops em erros lógicos. Coeficiente 2.0 = exponencial padrão.

**Consequences:** Retry rounds emitem spans `workflow.step.<id>` separados com `step.attempt: N`. Cancellation via AbortSignal aborta mid-backoff (não espera o sleep terminar). Documentar interação com idempotência (callers devem garantir).

### D238 — Saga compensation é **opt-in via `compensate?` per step**, LIFO, **deferida para v1.2**

**Decision:** Reservar o slot na interface `Step` (campo `compensate?: (input, output, error) => Promise<void>`) mas NÃO implementar engine logic em v1. v1.2 adiciona executor branch: em caso de erro fatal, executor percorre `compensations: Array<() => Promise<void>>` em LIFO e roda cada uma em `nonCancellable` mode.

**Rationale:** Saga é gap em todos os 4 concorrentes (oportunidade de diferenciação). Mas implementação correta é complexa (parallel branches que compensam parcialmente, conditional steps cuja compensação depende do galho). v1 ship sem saga = atinge paridade. v1.2 ship com saga = diferenciação.

**Consequences:** Documentar `compensate?` como "pré-reservado, NÃO implementado em v1". Throws `NotImplementedError` se passado. Type signature já estável para forward-compat. Edge case (EC-A do edge review): garantir que `compensate?: undefined` é equivalente a ausência (não throw).

### D239 — Step IDs são **user-provided strings obrigatórios**, validados por grammar `^[a-z0-9][a-z0-9_-]*$`

**Decision:** Cada step requer `id` único dentro do workflow. Builder valida unicidade em `.commit()`. Grammar copiada de D81 (`sanitizeIdentifier`). IDs servem como chaves de memoização (resume) e nomes de spans (telemetry).

**Rationale:** Inngest pattern — determinismo para retomada após crash. Auto-gerados (uuid) quebram resume entre rebuilds. Grammar restritiva evita injeção em paths/spans/SQL keys.

**Consequences:** `WorkflowDuplicateStepIdError` thrown em `.commit()`. Documentar consequência de rename ID (perde snapshot resumível). Caller pode prefixar IDs (`"phase1.fetch"`) para namespacing manual.

### D240 — `.parallel` e `.foreach` reusam `Agent.batch`-style semáforo (`internal/runtime/async-semaphore.ts`)

**Decision:** Não reimplementar concurrency control. Importar `AsyncSemaphore` (in-house, D135) e usar no executor para `kind: "parallel" | "foreach"`. Default concurrency: `parallel` ilimitado (todos branches simultâneos), `foreach` 4 (mesmo de batch D136).

**Rationale:** D135 já existe, testado com fast-check (1600 runs). Reescrever = code duplication. Defaults diferem porque `parallel` declara N branches estaticamente (caller já controlou); `foreach` é dinâmico (proteger contra lista grande).

**Consequences:** Mudar comportamento de `AsyncSemaphore` afeta ambos. Tests devem verificar concurrency cap respeitado. Documentar como override (`{ concurrency: N }`).

### D241 — Telemetry via existing OTel seam (`internal/telemetry/`), spans `workflow.run` + `workflow.step.<id>`

**Decision:** Lazy load `@opentelemetry/api` via `createRequire` (mesmo padrão D34/D206/D220). Span hierarchy: `workflow.run` (root) → `workflow.step.<id>` (child per step) → `workflow.step.<id>` (grandchild para retry attempts). Attributes: `workflow.id`, `workflow.name`, `step.kind`, `step.attempt`, `step.status`.

**Rationale:** Telemetria sem cobrança de install — usuários sem OTel pagam zero. Padrão validado em 3 features (Eval D206, Handoff D220, agent loop genérico). Span names previsíveis facilitam dashboards.

**Consequences:** Tests usam `noop` tracer; integration tests podem mockar `getActiveSpan()`. Atributos serializáveis (sem `Function`, sem `Symbol`). Documentar como ligar OTel.

### D242 — Single-flight por `(workflowName, runId)` — duas chamadas `.run()` simultâneas com o mesmo runId throw `WorkflowAlreadyRunningError`

**Decision:** `Map<string, AbortController>` global no módulo. Key = `${name}:${runId}`. Em-flight runs registram lock; release no finally. Resume também respeita o lock.

**Rationale:** Mesma garantia de D213 (Eval). Two-runs-same-id é sempre bug (idempotência quebrada). Falhar alto é mais seguro que silent race.

**Consequences:** Tests de single-flight (similar a `eval/single-flight.test.ts`). Edge case: process crash mid-run libera lock automaticamente (lock vive in-memory). Documentar.

### D243 — Erros em `.parallel` branches isolados; **first-error fail-fast por default**

**Decision:** Em `.parallel([a, b, c])`, se `b` falha:
- Default: aborta `a` e `c` (AbortSignal), `WorkflowParallelError` agregando errors.
- Opt-out: `parallel(..., { errorPolicy: "collect" })` — todos completam, erros retornam como `Either<value, error>`.

**Rationale:** Fail-fast é mais comum (cancel pending operations em erro real). Collect é útil para "best-effort" patterns (e.g. fan-out de provider checks). Default conservador, opt-in mais permissivo.

**Consequences:** Tests devem cobrir ambos modos. Documentar trade-off. CompactRun snapshot deve registrar partial results em `collect` mode.

### D244 — `CloudAgent.runWorkflow` throws `UnsupportedRunOperationError`

**Decision:** v1 implementa workflows apenas para `LocalAgent`. Cloud delegation segue convenção D122 (runUntil cloud-unsupported) + D169 (personality cloud-unsupported).

**Rationale:** Cloud runtime (Theo PaaS) ainda pre-release. Workflows precisam de execution control fino (cancellation, snapshot serialization) que ainda não está modelado no cloud payload. Não bloquear ship por isso.

**Consequences:** `examples/workflows/` documenta "local-only". Cloud paridade entra no roadmap quando PaaS shippar (mesmo padrão de outras features).

### D245 — Cancellation via `AbortSignal` em **boundaries de step** + `ctx.signal` exposto a step.fn

**Decision:** `.run(input, { signal })` injeta o signal no executor. Checa `signal.aborted` antes de iniciar cada step. Step.fn recebe `ctx.signal` para fazer fetch/sleep cancelável. Mid-step abort termina pendente backoff sleep.

**Rationale:** AbortSignal é o padrão TS canônico (já usado por D117 runUntil, D140 batch). Step boundaries garantem que abort não corrompe state (step.fn é tratado como atômico).

**Consequences:** Step.fn que faz HTTP fetch deve passar `ctx.signal` ao `fetch(url, { signal })`. Documentar pattern. Tests fast-check com signal aborts em pontos diferentes.

### D246 — Workflow **compõe** sobre runUntil/handoffs/batch, NÃO substitui

**Decision:** Workflow.create NUNCA chama internals de `runUntil`/`fork`/`batch`. Sempre via API pública. Steps que precisam handoff usam `Agent.create({ handoffs: [...] })` no agent passado para `kind: "agent"`. Steps que precisam runUntil usam `agent.runUntil(...)` dentro de `kind: "fn"`.

**Rationale:** Acoplamento solto → APIs evoluem independentes. Workflow é layer thin sobre primitives existentes (handoffs/batch/runUntil já carregam complexidade individual). Workflow.send foi rejeitado — Workflow é não-conversacional.

**Consequences:** Refactor de handoffs não quebra workflows (mesma garantia que CrewAI vs Mastra). Tests podem mockar agent.send sem fork interno. Documentar boundary.

### D247 — `step.fn` signature: `(input, ctx) => Promise<output>` onde `ctx = { runId, signal, telemetry, log }`

**Decision:** Step functions recebem o output do step anterior como `input` + `ctx` com utilities (`runId` para logging, `signal` para cancel, `telemetry.span` para spans custom, `log` wrapped logger). Tipo de `output` propagado pelo builder via generic.

**Rationale:** `ctx` separado evita poluir `input`. `telemetry.span` permite trace custom dentro do step. `log` redacted via existing redactSecrets seam (D68-D73).

**Consequences:** Step.fn signature simples (2 params, retorna Promise). Mock fácil em tests. `ctx` interface estável + extensível (adicionar campo = non-breaking).

### D248 — Initial scope: 7 primitives shipados + `compensate` (D238) e cloud (D244) deferidos

**Decision:** v1 ship:
- `.then(step)`, `.parallel([steps])`, `.branch(predicates)`, `.foreach(step)`, `.dowhile(step, cond)`, `.sleep(ms)`, `.suspend()`.

Não ship em v1:
- `.compensate(rollbackFn)` saga support (D238).
- `CloudAgent.runWorkflow` (D244).
- SQLite/Postgres persistence backends (apenas in-memory + JSON).
- Cron-trigger integration (`Cron.create({ workflow })`).

**Rationale:** 7 primitives cobrem Mastra parity. Saga + cloud + outros backends ficam pra v1.1+ quando houver demanda real. KISS first ship.

**Consequences:** Document v1 scope explicitly. Roadmap items v1.1+ rastreados em CLAUDE.md "Adoption Roadmap" tabela.

## Dependency Graph

```
Phase 0 (Setup) ──▶ Phase 1 (Types + Public Surface)
                          │
                          ▼
                   Phase 2 (Sequential + Parallel)
                          │
                          ▼
                   Phase 3 (Control Flow: branch/foreach/dowhile)
                          │
                          ├──────────────┐
                          ▼              ▼
                  Phase 4 (Retry)   Phase 5 (Persistence + Suspend/Resume)
                          │              │
                          └──────┬───────┘
                                 ▼
                          Phase 6 (Telemetry OTel)
                                 │
                                 ▼
                          Phase 7 (Agent integration)
                                 │
                                 ▼
                          Phase 8 (Examples + telegram-pro /workflow_demo)
                                 │
                                 ▼
                          Phase 9 (Dogfood QA)
```

**Parallelizáveis:** Phase 4 (Retry) e Phase 5 (Persistence) podem rodar em paralelo após Phase 3.
**Bloqueadores sequenciais:** Phase 0 → 1 → 2 → 3 obrigatório.
**Final gate:** Phase 9 (Dogfood QA) só após 7-8 verde.

---

## Phase 0: Setup e ADRs

**Objective:** Registrar D230-D248 como ADRs persistentes e criar architecture snapshot do estado pre-workflow.

### T0.1 — Escrever 19 ADRs (D230-D248)

#### Objective
Materializar cada decisão acima como arquivo Markdown sob `.claude/knowledge-base/adrs/`.

#### Evidence
Padrão estabelecido: D202-D213 (Eval) e D214-D229 (Handoffs) seguem template `D{N}-{slug}.md` com seções `Decision / Rationale / Consequences`. Cada ADR é linkada em `CLAUDE.md` tabela.

#### Files to edit
```
.claude/knowledge-base/adrs/D230-workflow-class-factory.md (NEW)
.claude/knowledge-base/adrs/D231-builder-mutable-commit.md (NEW)
.claude/knowledge-base/adrs/D232-step-discriminated-union.md (NEW)
.claude/knowledge-base/adrs/D233-mastra-naming.md (NEW)
.claude/knowledge-base/adrs/D234-explicit-input-output-state.md (NEW)
.claude/knowledge-base/adrs/D235-persistence-in-memory-default.md (NEW)
.claude/knowledge-base/adrs/D236-suspend-resume.md (NEW)
.claude/knowledge-base/adrs/D237-retry-policy-temporal-shape.md (NEW)
.claude/knowledge-base/adrs/D238-compensate-deferred-v12.md (NEW)
.claude/knowledge-base/adrs/D239-step-id-grammar.md (NEW)
.claude/knowledge-base/adrs/D240-reuse-async-semaphore.md (NEW)
.claude/knowledge-base/adrs/D241-telemetry-otel-seam.md (NEW)
.claude/knowledge-base/adrs/D242-single-flight-per-runId.md (NEW)
.claude/knowledge-base/adrs/D243-parallel-error-fail-fast.md (NEW)
.claude/knowledge-base/adrs/D244-cloud-runworkflow-unsupported.md (NEW)
.claude/knowledge-base/adrs/D245-abort-signal-boundaries.md (NEW)
.claude/knowledge-base/adrs/D246-workflow-composes-not-replaces.md (NEW)
.claude/knowledge-base/adrs/D247-step-fn-signature.md (NEW)
.claude/knowledge-base/adrs/D248-v1-scope.md (NEW)
CLAUDE.md (MODIFY — adicionar 19 linhas à tabela ADR + bumpar roadmap entry)
```

#### Deep file dependency analysis
- ADRs são standalone — nenhum import. Linked apenas pelo CLAUDE.md table.
- CLAUDE.md table append-only (não modificar D202-D229 rows).
- Roadmap section atualiza `#5` para "Em progresso" durante implementação.

#### Tasks
1. Criar 19 arquivos D230-D248 seguindo template Decision/Rationale/Consequences.
2. Apêndar 19 linhas à tabela `## Decided ADRs` em CLAUDE.md.
3. Atualizar Adoption Roadmap entry #5 (status: "Em progresso").
4. Commit: `docs(adr): register D230-D248 for Workflows primitive`.

#### TDD
```
N/A — ADRs são documentação. Validação: grep -c "^| D2[3-4][0-9] " CLAUDE.md deve dar 19.
```

#### Acceptance Criteria
- [ ] 19 arquivos `D230-*.md` a `D248-*.md` existem em `.claude/knowledge-base/adrs/`.
- [ ] Cada ADR tem 3 seções: Decision / Rationale / Consequences.
- [ ] CLAUDE.md table tem 19 novas linhas (sem quebrar a estrutura).
- [ ] Roadmap entry #5 marcado "Em progresso" com data 2026-05-22.

#### DoD
- [ ] `ls .claude/knowledge-base/adrs/D2{3,4}*.md | wc -l` retorna 19.
- [ ] `grep -c "^| D24[5-8] " CLAUDE.md` retorna 4 (D245-D248).
- [ ] Commit verde no main.

---

### T0.2 — Architecture snapshot pre-workflow

#### Objective
Capturar estado atual do domínio `runtime` (que vai receber workflow) ANTES das mudanças. Permite diff exato no end-game.

#### Evidence
Skill `/to-plan` exige snapshot BEFORE em `.claude/knowledge-base/architecture/{domain}/`. Padrão validado em todos os planos anteriores.

#### Files to edit
```
.claude/knowledge-base/architecture/workflow/system-context.md (NEW)
.claude/knowledge-base/architecture/workflow/container-diagram.md (NEW)
.claude/knowledge-base/architecture/workflow/component-runtime.md (NEW)
.claude/knowledge-base/architecture/workflow/deep-dive.md (NEW)
```

#### Tasks
1. Mapear módulos atuais que workflow vai compor: `agent-loop/`, `runtime/`, `runtime/fork-agent.ts`, `internal/persistence/`, `internal/telemetry/`.
2. Diagramar como Workflow vai sentar entre Agent.create (consumer) e internal/executor (provider).
3. Documentar zero downstream consumers atuais (workflow é greenfield).

#### TDD
```
N/A — snapshot estrutural.
```

#### Acceptance Criteria
- [ ] 4 arquivos de arquitetura criados.
- [ ] system-context mostra Workflow como novo componente no boundary.
- [ ] deep-dive mostra step types e executor algorithm pseudo-code.

#### DoD
- [ ] `ls .claude/knowledge-base/architecture/workflow/*.md | wc -l` retorna 4.
- [ ] Snapshots commitados.

---

## Phase 1: Types + Public Surface

**Objective:** Definir contratos públicos (types) e classe `Workflow` + builder + factory, sem executor logic.

### T1.1 — Public types em `types/workflow.ts`

#### Objective
Materializar tipos `WorkflowOptions`, `Step`, `StepContext`, `WorkflowRun`, `WorkflowSnapshot`, error classes.

#### Evidence
Padrão estabelecido: `types/eval.ts`, `types/handoff.ts`, `types/agent.ts` exportam types públicos. Re-export via `types/index.ts`.

#### Files to edit
```
packages/sdk/src/types/workflow.ts (NEW)
packages/sdk/src/types/index.ts (MODIFY — adicionar re-exports)
```

#### Deep file dependency analysis
- `types/workflow.ts` importa `SDKAgent` from `./agent.js`, `ZodType` from `zod`.
- Discriminated union via `kind` field — switch exhaustivo no executor.
- Error classes extendem `Error` direto (não `TheokitAgentError` ainda — workflow não tem error code namespace mapeado D66-D67).

#### Deep Dives

**Step discriminated union:**

```typescript
export type Step =
  | FnStep
  | AgentStep
  | ParallelStep
  | BranchStep
  | ForeachStep
  | DowhileStep
  | SleepStep
  | SuspendStep;

export interface FnStep {
  readonly kind: "fn";
  readonly id: string;
  readonly fn: <I, O>(input: I, ctx: StepContext) => Promise<O>;
  readonly inputSchema?: ZodType;
  readonly outputSchema?: ZodType;
  readonly retry?: RetryPolicy;
  readonly compensate?: (input: unknown, output: unknown, error: Error) => Promise<void>;
}

export interface AgentStep {
  readonly kind: "agent";
  readonly id: string;
  readonly agent: SDKAgent;
  readonly promptTemplate: string | ((input: unknown) => string);
  readonly retry?: RetryPolicy;
}

export interface ParallelStep {
  readonly kind: "parallel";
  readonly id: string;
  readonly branches: ReadonlyArray<ReadonlyArray<Step>>;
  readonly concurrency?: number;
  readonly errorPolicy?: "fail-fast" | "collect";
}

export interface BranchStep {
  readonly kind: "branch";
  readonly id: string;
  readonly predicates: ReadonlyArray<[
    (input: unknown) => boolean | Promise<boolean>,
    ReadonlyArray<Step>,
  ]>;
  readonly fallback?: ReadonlyArray<Step>;
}

export interface ForeachStep {
  readonly kind: "foreach";
  readonly id: string;
  readonly iterableFrom: string; // ID of upstream step whose output is iterable
  readonly step: Step;
  readonly concurrency?: number;
}

export interface DowhileStep {
  readonly kind: "dowhile";
  readonly id: string;
  readonly step: Step;
  readonly condFn: (output: unknown, iteration: number) => boolean | Promise<boolean>;
  readonly maxIterations?: number;
}

export interface SleepStep {
  readonly kind: "sleep";
  readonly id: string;
  readonly durationMs: number;
}

export interface SuspendStep {
  readonly kind: "suspend";
  readonly id: string;
  readonly payloadSchema?: ZodType;
}
```

**RetryPolicy** (EC-3 absorbed — `maxAttempts` validado via Zod `z.number().int().min(1).max(20)`):

```typescript
export interface RetryPolicy {
  /** Total attempts (MIN 1, MAX 20). `1` = no retry. */
  readonly maxAttempts: number;
  readonly initialBackoffMs?: number;
  readonly backoffCoefficient?: number;
  readonly maximumBackoffMs?: number;
  readonly nonRetryableErrors?: ReadonlyArray<string>;
}
```

**StepContext:**

```typescript
export interface StepContext {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly log: {
    debug: (msg: string, attrs?: Record<string, unknown>) => void;
    info: (msg: string, attrs?: Record<string, unknown>) => void;
    warn: (msg: string, attrs?: Record<string, unknown>) => void;
  };
  readonly suspend: (payload?: unknown) => Promise<never>;
}
```

**WorkflowRun + WorkflowSnapshot:**

```typescript
export interface WorkflowRun<TOutput = unknown> {
  readonly id: string;
  readonly name: string;
  readonly status: "running" | "completed" | "failed" | "suspended" | "cancelled";
  readonly output?: TOutput;
  readonly error?: { name: string; message: string };
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly stepResults: ReadonlyArray<StepResult>;
}

export interface StepResult {
  readonly stepId: string;
  readonly kind: Step["kind"];
  readonly status: "completed" | "failed" | "skipped" | "suspended";
  readonly attempts: number;
  readonly durationMs: number;
  readonly output?: unknown;
  readonly error?: { name: string; message: string };
}

export interface WorkflowSnapshot {
  readonly _schemaVersion: 1;
  readonly runId: string;
  readonly workflowName: string;
  readonly currentStepId: string;
  readonly suspendedPayload?: unknown;
  readonly stepResults: ReadonlyArray<StepResult>;
  readonly accumulatedState: Record<string, unknown>;
  readonly suspendedAt: number;
}
```

**Error classes** (5):

```typescript
export class WorkflowDuplicateStepIdError extends Error {
  override readonly name = "WorkflowDuplicateStepIdError";
  constructor(public readonly stepId: string) {
    super(`Duplicate step id "${stepId}" in workflow.`);
  }
}

export class WorkflowAlreadyRunningError extends Error {
  override readonly name = "WorkflowAlreadyRunningError";
  constructor(public readonly workflowName: string, public readonly runId: string) {
    super(`Workflow "${workflowName}" run "${runId}" already in-flight.`);
  }
}

export class WorkflowSnapshotNotFoundError extends Error {
  override readonly name = "WorkflowSnapshotNotFoundError";
  constructor(public readonly runId: string) {
    super(`No snapshot found for runId "${runId}". Configure persistence to enable resume.`);
  }
}

export class WorkflowMaxIterationsExceededError extends Error {
  override readonly name = "WorkflowMaxIterationsExceededError";
  constructor(public readonly stepId: string, public readonly maxIterations: number) {
    super(`Step "${stepId}" exceeded max iterations (${maxIterations}).`);
  }
}

export class WorkflowParallelError extends AggregateError {
  override readonly name = "WorkflowParallelError";
  constructor(errors: ReadonlyArray<Error>, public readonly stepId: string) {
    super(errors, `${errors.length} branch(es) failed in parallel step "${stepId}".`);
  }
}

// EC-4 absorbed
export class WorkflowNotSerializableError extends Error {
  override readonly name = "WorkflowNotSerializableError";
  constructor(public readonly stepId: string, public readonly cause: Error) {
    super(`Workflow snapshot at step "${stepId}" failed to serialize as JSON: ${cause.message}. ` +
      `Persisted snapshots support only JSON-serializable values (no BigInt, no circular refs, no class instances with cycles).`);
  }
}

// EC-8 absorbed (added in SHOULD TEST set)
export class WorkflowResumeStepNotFoundError extends Error {
  override readonly name = "WorkflowResumeStepNotFoundError";
  constructor(public readonly stepId: string, public readonly workflowName: string) {
    super(`Cannot resume: step "${stepId}" not found in workflow "${workflowName}". ` +
      `The Workflow definition diverged from the snapshot.`);
  }
}
```

#### Tasks
1. Criar `packages/sdk/src/types/workflow.ts` com types acima.
2. Re-exportar via `types/index.ts`.
3. `pnpm typecheck` em verde.

#### TDD
```
RED: types/workflow.test.ts → expectType / expectError compile-time checks
  - Step union exhaustivo (switch sem default)
  - RetryPolicy default merge type-safe
  - WorkflowRun<TOutput> generic propagado
GREEN: define types
REFACTOR: garantir nenhum import circular (workflow.ts → agent.ts OK; agent.ts ↛ workflow.ts)
VERIFY: pnpm -F @theokit/sdk typecheck
```

#### Acceptance Criteria
- [ ] `types/workflow.ts` criado e exporta 9 step types + 5 error classes + WorkflowRun + StepResult + WorkflowSnapshot.
- [ ] `types/index.ts` re-exporta tudo.
- [ ] Type-test `Step` discriminated union exhaustivo (verificar em fn-step.test.ts).
- [ ] Zero import cycles (verificar `madge --circular packages/sdk/src/`).

#### DoD
- [ ] `pnpm -F @theokit/sdk typecheck` verde.
- [ ] `pnpm -F @theokit/sdk biome check src/types/workflow.ts` zero warnings.

---

### T1.2 — Public `Workflow` class + `WorkflowBuilder` em `workflow.ts`

#### Objective
Implementar a façade pública: `Workflow.create({...})` retorna builder; chains via `.then/.parallel/...`; `.commit()` retorna `Workflow` imutável; `.run(input, opts?)` retorna `Promise<WorkflowRun>`.

#### Evidence
Padrão em `eval.ts`, `handoff.ts`, `agent.ts`. Generic propagation via `<TInput, TOutput>` em `Workflow<TInput, TOutput>`.

#### Files to edit
```
packages/sdk/src/workflow.ts (NEW)
packages/sdk/src/index.ts (MODIFY — re-export Workflow + WorkflowBuilder + types)
```

#### Deep Dives

**Workflow class:**

```typescript
export class Workflow<TInput = unknown, TOutput = unknown> {
  private constructor(
    private readonly options: WorkflowOptions,
    private readonly steps: ReadonlyArray<Step>,
  ) {}

  static create<TI, TO>(options: WorkflowOptions): WorkflowBuilder<TI, TO> {
    WorkflowOptionsSchema.parse(options); // zod-validated
    return new WorkflowBuilder<TI, TO>(options);
  }

  async run(input: TInput, opts?: WorkflowRunOptions): Promise<WorkflowRun<TOutput>> {
    return executeWorkflow(this.options, this.steps, input, opts);
  }

  static async resume<TO>(opts: WorkflowResumeOptions): Promise<WorkflowRun<TO>> {
    return resumeWorkflow(opts);
  }
}
```

**WorkflowBuilder** (mutable chain):

```typescript
export class WorkflowBuilder<TInput, TOutput> {
  private readonly steps: Step[] = [];
  private committed = false;

  constructor(private readonly options: WorkflowOptions) {}

  then<TO>(step: Step): WorkflowBuilder<TInput, TO> {
    this.assertNotCommitted();
    this.steps.push(step);
    return this as unknown as WorkflowBuilder<TInput, TO>;
  }

  parallel(branches: ReadonlyArray<ReadonlyArray<Step>>, opts?: { concurrency?: number }): WorkflowBuilder<TInput, unknown> {
    this.assertNotCommitted();
    this.steps.push({
      kind: "parallel",
      id: opts?.id ?? `parallel-${this.steps.length}`,
      branches,
      ...(opts?.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
    });
    return this as WorkflowBuilder<TInput, unknown>;
  }

  branch(...): WorkflowBuilder { /* ... */ }
  foreach(...): WorkflowBuilder { /* ... */ }
  dowhile(...): WorkflowBuilder { /* ... */ }
  sleep(durationMs: number, id?: string): WorkflowBuilder { /* ... */ }
  suspend(id?: string, schema?: ZodType): WorkflowBuilder { /* ... */ }

  commit(): Workflow<TInput, TOutput> {
    this.assertNotCommitted();
    this.validateUniqueIds();
    this.committed = true;
    // EC-5: mint unique workflowId so single-flight lock is per-instance, not per-name
    const workflowId = `wf-${cryptoRandomShortId()}`;
    return new Workflow({ ...this.options, workflowId }, this.steps);
  }

  private validateUniqueIds(): void {
    const seen = new Set<string>();
    for (const s of this.steps) {
      if (seen.has(s.id)) throw new WorkflowDuplicateStepIdError(s.id);
      seen.add(s.id);
    }
  }

  private assertNotCommitted(): void {
    if (this.committed) throw new Error("Workflow already committed; create new builder.");
  }
}
```

**Factory helpers** (top-level functions, sibling de `Handoff.create`):

```typescript
export function fn<I, O>(id: string, fn: FnStep["fn"], opts?: Omit<FnStep, "kind" | "id" | "fn">): FnStep { /* ... */ }
export function agentStep(id: string, agent: SDKAgent, promptTemplate: AgentStep["promptTemplate"], opts?: Omit<AgentStep, "kind" | "id" | "agent" | "promptTemplate">): AgentStep { /* ... */ }
```

#### Tasks
1. Implementar `Workflow` class (private constructor, static create/resume).
2. Implementar `WorkflowBuilder` com 7 chainable methods (`then`, `parallel`, `branch`, `foreach`, `dowhile`, `sleep`, `suspend`) + `commit()`.
3. Implementar helpers `fn()`, `agentStep()` (export top-level).
4. Validar `id` grammar em cada `then/parallel/...` chamada (use `sanitizeIdentifier` D81).
5. Re-export tudo no `index.ts`.

#### TDD
```
RED:
  - workflow_create_validates_options_via_zod
  - workflow_builder_then_chains_return_self
  - workflow_builder_commit_throws_on_duplicate_id
  - workflow_builder_commit_returns_immutable
  - workflow_run_calls_execute_with_options_and_steps (executor mocked)
  - workflow_factory_helpers_validate_id_grammar
  - workflow_step_id_invalid_throws (uppercase, dot, etc)
  - EC-9: builder_commit_called_twice_throws
  - EC-3: retry_policy_maxAttempts_zero_rejected_by_zod
  - EC-5: workflow_commit_mints_unique_workflowId
GREEN: implement class + builder
REFACTOR: ensure no executor logic leaked into workflow.ts
VERIFY: pnpm -F @theokit/sdk test tests/workflow/workflow-create.test.ts
```

#### Acceptance Criteria
- [ ] `workflow.ts` ≤ 250 LoC (com helpers).
- [ ] Builder.commit() throws para `WorkflowDuplicateStepIdError`.
- [ ] Zero referência a executor internals — apenas a `executeWorkflow` import.
- [ ] 6+ tests verde em `tests/workflow/workflow-create.test.ts`.

#### DoD
- [ ] `pnpm -F @theokit/sdk test tests/workflow/workflow-create.test.ts` verde.
- [ ] Biome zero warnings.
- [ ] `index.ts` re-exporta `Workflow`, `WorkflowBuilder`, `fn`, `agentStep`, 5 error classes, RetryPolicy, todos os Step types.

---

## Phase 2: Sequential + Parallel Executor

**Objective:** Implementar executor para `kind: "fn"`, `kind: "agent"`, `kind: "parallel"` (sem retry, sem persistence ainda).

### T2.1 — `internal/workflow/executor.ts` core dispatch

#### Objective
Função `executeWorkflow(options, steps, input, opts)` que percorre steps sequencialmente, invocando o handler certo por step.kind.

#### Files to edit
```
packages/sdk/src/internal/workflow/executor.ts (NEW)
packages/sdk/src/internal/workflow/index.ts (NEW — barrel)
packages/sdk/src/internal/workflow/step-fn.ts (NEW)
packages/sdk/src/internal/workflow/step-agent.ts (NEW)
packages/sdk/src/internal/workflow/step-parallel.ts (NEW)
packages/sdk/src/internal/workflow/single-flight.ts (NEW)
packages/sdk/src/internal/workflow/run-id.ts (NEW)
```

#### Deep file dependency analysis

- `executor.ts` → switch on step.kind → dispatch para `step-{kind}.ts`.
- `step-fn.ts` → invoca `step.fn(input, ctx)`.
- `step-agent.ts` → resolve `promptTemplate` (string ou function), chama `agent.send(prompt)`, retorna `result.result`.
- `step-parallel.ts` → reusa `AsyncSemaphore` from `internal/runtime/async-semaphore.ts` (D135).
- `single-flight.ts` → Map<key, AbortController> exatamente como `internal/eval/single-flight.ts`.
- `run-id.ts` → `crypto.randomUUID().slice(0, 8)` prefixed com `wf-`.

#### Deep Dives

**Executor core:**

```typescript
export async function executeWorkflow<TInput, TOutput>(
  options: WorkflowOptions,
  steps: ReadonlyArray<Step>,
  input: TInput,
  runOpts?: WorkflowRunOptions,
): Promise<WorkflowRun<TOutput>> {
  const runId = runOpts?.runId ?? mintRunId();
  // EC-5: lock key is `<workflowId>:<runId>`, not `<name>:<runId>`
  const flight = acquireSingleFlight(options.workflowId, runId);
  const startedAt = Date.now();
  const signal = combineSignals(runOpts?.signal, flight.signal);
  // EC-1: fail fast if signal already aborted (matches Agent.batch D140)
  if (signal.aborted) throw new DOMException(signal.reason ?? "Aborted", "AbortError");
  const ctx = makeStepContext({ runId, signal });
  const stepResults: StepResult[] = [];

  let acc: unknown = input;
  try {
    for (const step of steps) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const result = await dispatchStep(step, acc, ctx, options);
      stepResults.push(result);
      if (result.status === "failed") {
        return assembleRun({ runId, name: options.name, status: "failed", stepResults, startedAt, error: result.error });
      }
      if (result.status === "suspended") {
        return assembleRun({ runId, name: options.name, status: "suspended", stepResults, startedAt });
      }
      acc = result.output;
    }
    return assembleRun({ runId, name: options.name, status: "completed", output: acc as TOutput, stepResults, startedAt });
  } catch (err) {
    return assembleRun({ runId, name: options.name, status: "failed", stepResults, startedAt, error: errToShape(err) });
  } finally {
    releaseSingleFlight(options.name, runId);
  }
}

async function dispatchStep(step: Step, input: unknown, ctx: StepContext, options: WorkflowOptions): Promise<StepResult> {
  switch (step.kind) {
    case "fn": return runFnStep(step, input, ctx);
    case "agent": return runAgentStep(step, input, ctx);
    case "parallel": return runParallelStep(step, input, ctx, options);
    case "branch": throw new Error("Phase 3 not yet");
    case "foreach": throw new Error("Phase 3 not yet");
    case "dowhile": throw new Error("Phase 3 not yet");
    case "sleep": return runSleepStep(step, input, ctx);
    case "suspend": throw new Error("Phase 5 not yet");
    default: { const _: never = step; throw new Error(`Unknown step kind: ${(_ as Step).kind}`); }
  }
}
```

**step-parallel.ts:**

```typescript
export async function runParallelStep(
  step: ParallelStep,
  input: unknown,
  ctx: StepContext,
  options: WorkflowOptions,
): Promise<StepResult> {
  const startedAt = Date.now();
  const policy = step.errorPolicy ?? "fail-fast";
  const concurrency = step.concurrency ?? step.branches.length;
  const sem = new AsyncSemaphore(concurrency);
  const branchSignal = policy === "fail-fast" ? combineSignals(ctx.signal, mintAbortable()) : ctx.signal;

  const promises = step.branches.map((branch, i) => sem.run(async () => {
    const subCtx = { ...ctx, signal: branchSignal };
    let acc: unknown = input;
    for (const inner of branch) {
      const r = await dispatchStep(inner, acc, subCtx, options);
      if (r.status === "failed") throw new Error(r.error?.message ?? "branch failed");
      acc = r.output;
    }
    return acc;
  }));

  if (policy === "fail-fast") {
    try {
      const outputs = await Promise.all(promises);
      return { stepId: step.id, kind: "parallel", status: "completed", attempts: 1, durationMs: Date.now() - startedAt, output: outputs };
    } catch (err) {
      // abort other branches
      (branchSignal as any).abort?.();
      return { stepId: step.id, kind: "parallel", status: "failed", attempts: 1, durationMs: Date.now() - startedAt, error: errToShape(err) };
    }
  } else {
    const settled = await Promise.allSettled(promises);
    const outputs = settled.map((s) => s.status === "fulfilled" ? { ok: true, value: s.value } : { ok: false, error: s.reason });
    return { stepId: step.id, kind: "parallel", status: "completed", attempts: 1, durationMs: Date.now() - startedAt, output: outputs };
  }
}
```

#### Tasks
1. Implementar `executor.ts` core dispatch.
2. Implementar `step-fn.ts`, `step-agent.ts`, `step-parallel.ts`, `step-sleep.ts`.
3. Implementar `single-flight.ts`, `run-id.ts`.
4. Stub `step-branch.ts`, `step-foreach.ts`, `step-dowhile.ts`, `step-suspend.ts` (throw "Phase N not yet").

#### TDD
```
RED:
  - executor_runs_sequential_then_chain
  - executor_propagates_output_to_next_step_input
  - executor_returns_failed_on_step_error
  - parallel_runs_branches_concurrently
  - parallel_fail_fast_aborts_pending_branches
  - parallel_collect_returns_per_branch_results
  - parallel_respects_concurrency_cap
  - agent_step_uses_promptTemplate_function
  - agent_step_uses_promptTemplate_string
  - sleep_step_pauses_for_durationMs
  - single_flight_throws_on_duplicate_runid
  - EC-1: executor_throws_AbortError_when_signal_already_aborted_at_entry
  - EC-5: single_flight_key_uses_workflowId_not_name
  - EC-6: parallel_empty_branches_returns_empty_output_array
GREEN: implement all
REFACTOR: extract assembleRun + errToShape + combineSignals helpers
VERIFY: pnpm test tests/workflow/executor.test.ts tests/workflow/parallel.test.ts
```

#### Acceptance Criteria
- [ ] 11 tests verde.
- [ ] `executor.ts` ≤ 200 LoC.
- [ ] Cada `step-*.ts` ≤ 100 LoC.
- [ ] `pnpm -F @theokit/sdk biome check` zero warnings.

#### DoD
- [ ] `pnpm -F @theokit/sdk test tests/workflow/` 11/11 verde.
- [ ] Build CJS+ESM+DTS verde.

---

## Phase 3: Control Flow (branch / foreach / dowhile)

**Objective:** Implementar 3 primitives restantes do v1 (sem retry/persistence ainda).

### T3.1 — `step-branch.ts`

#### Objective
Implementar dispatch de `kind: "branch"` (first-match-wins predicates + fallback).

#### Files to edit
```
packages/sdk/src/internal/workflow/step-branch.ts (MODIFY — remover stub, implementar)
```

#### Deep Dives

```typescript
export async function runBranchStep(step: BranchStep, input: unknown, ctx: StepContext, options: WorkflowOptions): Promise<StepResult> {
  const startedAt = Date.now();
  for (let i = 0; i < step.predicates.length; i += 1) {
    const [predicate, branch] = step.predicates[i]!;
    // EC-2: predicate throw -> warn + treat as "no match" (don't propagate user-code bug)
    let matched = false;
    try { matched = await Promise.resolve(predicate(input)); }
    catch (err) {
      console.warn(`[workflow] branch "${step.id}" predicate ${i} threw, treating as no-match:`,
        err instanceof Error ? err.message : err);
    }
    if (matched) {
      let acc = input;
      for (const inner of branch) {
        const r = await dispatchStep(inner, acc, ctx, options);
        if (r.status === "failed") return { stepId: step.id, kind: "branch", status: "failed", attempts: 1, durationMs: Date.now() - startedAt, error: r.error };
        acc = r.output;
      }
      return { stepId: step.id, kind: "branch", status: "completed", attempts: 1, durationMs: Date.now() - startedAt, output: acc };
    }
  }
  if (step.fallback !== undefined) {
    let acc = input;
    for (const inner of step.fallback) {
      const r = await dispatchStep(inner, acc, ctx, options);
      if (r.status === "failed") return { stepId: step.id, kind: "branch", status: "failed", attempts: 1, durationMs: Date.now() - startedAt, error: r.error };
      acc = r.output;
    }
    return { stepId: step.id, kind: "branch", status: "completed", attempts: 1, durationMs: Date.now() - startedAt, output: acc };
  }
  // No fallback, no match: input passes through unchanged
  return { stepId: step.id, kind: "branch", status: "skipped", attempts: 0, durationMs: Date.now() - startedAt, output: input };
}
```

#### TDD
```
RED:
  - branch_first_matching_predicate_runs
  - branch_subsequent_predicates_not_evaluated_after_match
  - branch_async_predicates_supported
  - branch_no_match_runs_fallback
  - branch_no_match_no_fallback_passes_input_through
  - branch_inner_step_failure_propagates
  - EC-2: branch_predicate_throws_treated_as_no_match_with_stderr_warn
GREEN: implement
VERIFY: pnpm test tests/workflow/branch.test.ts
```

#### Acceptance Criteria
- [ ] 6 tests verde.
- [ ] Cyclomatic complexity ≤ 10.

#### DoD
- [ ] Tests verde.

---

### T3.2 — `step-foreach.ts`

#### Objective
Implementar `kind: "foreach"` — itera sobre output do step referenced em `iterableFrom`.

#### Files to edit
```
packages/sdk/src/internal/workflow/step-foreach.ts (MODIFY — implementar)
```

#### Deep Dives

```typescript
export async function runForeachStep(
  step: ForeachStep,
  input: unknown,
  ctx: StepContext,
  options: WorkflowOptions,
  prevStepResults: ReadonlyArray<StepResult>,
): Promise<StepResult> {
  const startedAt = Date.now();
  const sourceResult = prevStepResults.find((r) => r.stepId === step.iterableFrom);
  if (sourceResult === undefined) {
    throw new Error(`foreach.iterableFrom "${step.iterableFrom}" not found in prior step results.`);
  }
  const items = sourceResult.output;
  if (!Array.isArray(items)) {
    throw new Error(`foreach.iterableFrom "${step.iterableFrom}" output must be Array, got ${typeof items}.`);
  }
  const concurrency = step.concurrency ?? 4;
  const sem = new AsyncSemaphore(concurrency);
  const outputs = await Promise.all(items.map((item) => sem.run(async () => {
    const r = await dispatchStep(step.step, item, ctx, options);
    if (r.status === "failed") throw new Error(r.error?.message);
    return r.output;
  })));
  return { stepId: step.id, kind: "foreach", status: "completed", attempts: 1, durationMs: Date.now() - startedAt, output: outputs };
}
```

**Edge case:** `foreach` depende de visibility de prior step results — executor passa `prevStepResults` array; foreach NUNCA acessa state pós-execução de outros foreach branches (EC-foreach-1: branches paralelos não veem outros).

#### TDD
```
RED:
  - foreach_runs_inner_step_per_item
  - foreach_respects_concurrency_cap
  - foreach_collects_outputs_in_input_order
  - foreach_throws_when_source_step_not_found
  - foreach_throws_when_source_output_not_array
  - foreach_propagates_inner_step_failure
  - EC-7: foreach_iterableFrom_inside_parallel_branch_throws_helpful_error
GREEN: implement
VERIFY: pnpm test tests/workflow/foreach.test.ts
```

#### Acceptance Criteria
- [ ] 6 tests verde.

#### DoD
- [ ] Tests verde.

---

### T3.3 — `step-dowhile.ts`

#### Objective
Implementar `kind: "dowhile"` — loop até cond=false ou maxIterations.

#### Files to edit
```
packages/sdk/src/internal/workflow/step-dowhile.ts (MODIFY — implementar)
```

#### Deep Dives

```typescript
export async function runDowhileStep(step: DowhileStep, input: unknown, ctx: StepContext, options: WorkflowOptions): Promise<StepResult> {
  const startedAt = Date.now();
  const maxIter = step.maxIterations ?? 100;
  let acc = input;
  let i = 0;
  while (true) {
    if (i >= maxIter) throw new WorkflowMaxIterationsExceededError(step.id, maxIter);
    const r = await dispatchStep(step.step, acc, ctx, options);
    if (r.status === "failed") return { stepId: step.id, kind: "dowhile", status: "failed", attempts: i + 1, durationMs: Date.now() - startedAt, error: r.error };
    acc = r.output;
    i += 1;
    const shouldContinue = await Promise.resolve(step.condFn(acc, i));
    if (!shouldContinue) break;
  }
  return { stepId: step.id, kind: "dowhile", status: "completed", attempts: i, durationMs: Date.now() - startedAt, output: acc };
}
```

#### TDD
```
RED:
  - dowhile_runs_at_least_once
  - dowhile_stops_when_cond_returns_false
  - dowhile_throws_on_max_iterations_exceeded
  - dowhile_default_max_iterations_100
  - dowhile_propagates_inner_failure
  - dowhile_async_condFn_supported
GREEN: implement
VERIFY: pnpm test tests/workflow/dowhile.test.ts
```

#### Acceptance Criteria
- [ ] 6 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 4: Retry Policy

**Objective:** Adicionar retry com backoff exponencial em `kind: "fn"` e `kind: "agent"`.

### T4.1 — `retry-policy.ts` helper

#### Objective
Função `withRetry(fn, policy, signal)` que envolve qualquer step.fn com retry loop respeitando AbortSignal.

#### Files to edit
```
packages/sdk/src/internal/workflow/retry-policy.ts (NEW)
packages/sdk/src/internal/workflow/step-fn.ts (MODIFY — wrap fn em withRetry se policy presente)
packages/sdk/src/internal/workflow/step-agent.ts (MODIFY — same)
```

#### Deep Dives

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  signal: AbortSignal,
): Promise<{ value: T; attempts: number }> {
  const max = policy.maxAttempts;
  const init = policy.initialBackoffMs ?? 1000;
  const coef = policy.backoffCoefficient ?? 2.0;
  const cap = policy.maximumBackoffMs ?? 30_000;
  const nonRetryable = new Set(policy.nonRetryableErrors ?? ["AbortError", "WorkflowSnapshotNotFoundError", "ConfigurationError"]);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const value = await fn();
      return { value, attempts: attempt };
    } catch (err) {
      lastErr = err;
      const errName = err instanceof Error ? err.name : "Error";
      if (nonRetryable.has(errName)) throw err;
      if (attempt === max) throw err;
      const backoff = Math.min(init * Math.pow(coef, attempt - 1), cap);
      await abortableSleep(backoff, signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { resolve(); cleanup(); }, ms);
    const onAbort = () => { clearTimeout(timer); cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort);
  });
}
```

#### Tasks
1. Implementar `retry-policy.ts` com `withRetry` + `abortableSleep`.
2. Wrap `step-fn.ts` e `step-agent.ts` para usar `withRetry` se policy presente.
3. Update `StepResult.attempts` para refletir retry count.

#### TDD
```
RED:
  - retry_succeeds_on_first_attempt_no_retry_needed
  - retry_retries_up_to_max_attempts
  - retry_respects_backoff_coefficient
  - retry_respects_maximum_backoff_cap
  - retry_aborts_mid_sleep_when_signal_fires
  - retry_throws_immediately_on_non_retryable_error
  - retry_propagates_last_error_after_max_attempts
  - step_fn_with_retry_records_attempts_count
  - step_agent_with_retry_records_attempts_count
GREEN: implement
REFACTOR: extract `mapToAbortableSleep` helper if duplicated
VERIFY: pnpm test tests/workflow/retry-policy.test.ts
```

#### Acceptance Criteria
- [ ] 9 tests verde.
- [ ] `retry-policy.ts` ≤ 100 LoC.

#### DoD
- [ ] Tests verde.

---

## Phase 5: Persistence + Suspend/Resume

**Objective:** Implementar `WorkflowSnapshotStore` interface + in-memory + JSON backends + `Workflow.resume(...)`.

### T5.1 — `WorkflowSnapshotStore` interface + in-memory backend

#### Files to edit
```
packages/sdk/src/internal/workflow/snapshot-store.ts (NEW — interface + InMemoryStore)
packages/sdk/src/internal/workflow/snapshot-store-json.ts (NEW — JsonFileStore)
```

#### Deep Dives

```typescript
export interface WorkflowSnapshotStore {
  save(snapshot: WorkflowSnapshot): Promise<void>;
  load(runId: string): Promise<WorkflowSnapshot | undefined>;
  delete(runId: string): Promise<void>;
  list(workflowName?: string): Promise<ReadonlyArray<{ runId: string; workflowName: string; suspendedAt: number }>>;
}

export class InMemoryWorkflowSnapshotStore implements WorkflowSnapshotStore {
  private readonly map = new Map<string, WorkflowSnapshot>();
  async save(snapshot: WorkflowSnapshot): Promise<void> { this.map.set(snapshot.runId, snapshot); }
  async load(runId: string): Promise<WorkflowSnapshot | undefined> { return this.map.get(runId); }
  async delete(runId: string): Promise<void> { this.map.delete(runId); }
  async list(workflowName?: string): Promise<ReadonlyArray<{ runId: string; workflowName: string; suspendedAt: number }>> {
    return [...this.map.values()]
      .filter((s) => workflowName === undefined || s.workflowName === workflowName)
      .map((s) => ({ runId: s.runId, workflowName: s.workflowName, suspendedAt: s.suspendedAt }));
  }
}
```

**JSON backend** usa `atomicWriteJson` (D60) + `readVersionedJson` (D62):

```typescript
export class JsonFileWorkflowSnapshotStore implements WorkflowSnapshotStore {
  constructor(private readonly dir: string) {}
  // 1 file per runId: <dir>/<workflowName>-<runId>.json
  // atomicWriteJson handles temp-file + rename
  // readVersionedJson handles _schemaVersion forward-compat
}
```

#### Tasks
1. Interface + InMemoryStore.
2. JsonFileStore com atomic write + versioned read.
3. Default store = InMemory (não preserva entre process restarts).

#### TDD
```
RED:
  - in_memory_store_save_and_load_round_trip
  - in_memory_store_delete_removes_snapshot
  - in_memory_store_list_filters_by_workflow_name
  - json_file_store_save_writes_atomically
  - json_file_store_load_returns_undefined_for_missing_run_id
  - json_file_store_list_scans_directory
  - json_file_store_schema_version_mismatch_throws
GREEN: implement
VERIFY: pnpm test tests/workflow/snapshot-store.test.ts
```

#### Acceptance Criteria
- [ ] 7 tests verde.

#### DoD
- [ ] Tests verde.

---

### T5.2 — `step-suspend.ts` + `Workflow.resume`

#### Files to edit
```
packages/sdk/src/internal/workflow/step-suspend.ts (MODIFY — implementar)
packages/sdk/src/internal/workflow/executor.ts (MODIFY — handle suspend status + Workflow.resume entry)
packages/sdk/src/workflow.ts (MODIFY — implement static resume method)
```

#### Deep Dives

**Suspend mechanism:**

```typescript
// In StepContext factory:
export function makeStepContext({ runId, signal, store, suspensionResolver }: StepContextParams): StepContext {
  return {
    runId,
    signal,
    log: makeLog(runId),
    suspend: async (payload?: unknown) => {
      // Throw a sentinel error that the executor catches
      throw new WorkflowSuspendedSentinel(payload);
    },
  };
}

class WorkflowSuspendedSentinel extends Error {
  constructor(public readonly payload?: unknown) { super("__workflow_suspended__"); }
}
```

Executor:

```typescript
try {
  const r = await dispatchStep(step, acc, ctx, options);
  // ...
} catch (err) {
  if (err instanceof WorkflowSuspendedSentinel) {
    const snapshot: WorkflowSnapshot = {
      _schemaVersion: 1,
      runId,
      workflowName: options.name,
      currentStepId: step.id,
      suspendedPayload: err.payload,
      stepResults: [...stepResults],
      accumulatedState: { acc },
      suspendedAt: Date.now(),
    };
    // EC-4: validate JSON-serializability BEFORE writing — surface a typed error
    let serialized: string;
    try { serialized = JSON.stringify(snapshot); }
    catch (jsonErr) {
      throw new WorkflowNotSerializableError(step.id, jsonErr instanceof Error ? jsonErr : new Error(String(jsonErr)));
    }
    await store.saveSerialized(snapshot.runId, serialized); // store impls accept pre-serialized string
    return assembleRun({ runId, name: options.name, status: "suspended", stepResults, startedAt });
  }
  throw err;
}
```

**Resume:**

```typescript
static async resume<TO>(opts: WorkflowResumeOptions): Promise<WorkflowRun<TO>> {
  const store = opts.store ?? defaultStore;
  const snapshot = await store.load(opts.runId);
  if (snapshot === undefined) throw new WorkflowSnapshotNotFoundError(opts.runId);
  return resumeFromSnapshot(snapshot, opts.payload, opts.workflow, opts.runOptions);
}
```

#### Tasks
1. Implementar `WorkflowSuspendedSentinel`.
2. Wire executor para detectar sentinel e persistir snapshot.
3. Implementar `step-suspend.ts` standalone (`kind: "suspend"` step).
4. Implementar `Workflow.resume(opts)` static.
5. Validate `payloadSchema` em resume (Zod parse).

#### TDD
```
RED:
  - ctx_suspend_throws_sentinel
  - executor_catches_sentinel_and_persists_snapshot
  - workflow_run_returns_suspended_status_on_suspend
  - workflow_resume_throws_on_missing_snapshot
  - workflow_resume_continues_from_currentStepId
  - workflow_resume_validates_payload_against_schema
  - suspend_step_kind_works_standalone
  - resume_with_no_persistence_throws_helpful_error
  - EC-4: suspend_with_BigInt_payload_throws_WorkflowNotSerializableError
  - EC-4: suspend_with_circular_ref_throws_WorkflowNotSerializableError
  - EC-8: resume_with_workflow_missing_currentStepId_throws_WorkflowResumeStepNotFoundError
GREEN: implement
VERIFY: pnpm test tests/workflow/suspend-resume.test.ts
```

#### Acceptance Criteria
- [ ] 8 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 6: Telemetry (OTel)

**Objective:** Emitir spans `workflow.run` + `workflow.step.<id>` via lazy OTel.

### T6.1 — `internal/workflow/telemetry.ts`

#### Files to edit
```
packages/sdk/src/internal/workflow/telemetry.ts (NEW)
packages/sdk/src/internal/workflow/executor.ts (MODIFY — wrap run + cada step com spans)
```

#### Deep Dives

Same pattern as `internal/handoff/telemetry.ts` and `internal/eval/telemetry.ts`:

```typescript
let cachedTracer: Tracer | undefined;
function getTracer(): Tracer | undefined {
  if (cachedTracer !== undefined) return cachedTracer;
  try {
    const r = createRequire(import.meta.url);
    const otel = r("@opentelemetry/api");
    cachedTracer = otel.trace.getTracer("@theokit/sdk/workflow", "1.0.0");
    return cachedTracer;
  } catch { return undefined; }
}

export function startWorkflowRunSpan(info: { workflowName: string; runId: string }): SpanLike {
  const tracer = getTracer();
  if (tracer === undefined) return noopSpan;
  return tracer.startSpan("workflow.run", { attributes: {
    "workflow.name": info.workflowName,
    "workflow.run_id": info.runId,
  }});
}

export function startWorkflowStepSpan(info: { stepId: string; kind: string; attempt: number }): SpanLike { /* ... */ }
```

#### Tasks
1. Implementar telemetry helper (mirror D220, D206).
2. Wrap executor: `startWorkflowRunSpan` em try/finally + `startWorkflowStepSpan` per step + atributo `step.attempt` em retries.

#### TDD
```
RED:
  - telemetry_no_otel_installed_returns_noop
  - telemetry_otel_present_starts_run_span
  - telemetry_step_span_includes_attempt_attribute
  - telemetry_span_ends_in_finally
  - EC-10: telemetry_step_span_ends_in_finally_when_step_fn_throws_synchronously
GREEN: implement
VERIFY: pnpm test tests/workflow/telemetry.test.ts
```

#### Acceptance Criteria
- [ ] 4 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 7: Agent integration (`kind: "agent"`)

**Objective:** Integração end-to-end com `SDKAgent.send`.

### T7.1 — `step-agent.ts` polish + cloud guard

#### Files to edit
```
packages/sdk/src/internal/workflow/step-agent.ts (MODIFY — cloud guard, abortable agent.send)
```

#### Deep Dives

```typescript
export async function runAgentStep(step: AgentStep, input: unknown, ctx: StepContext): Promise<StepResult> {
  const startedAt = Date.now();
  if (isCloudAgent(step.agent)) {
    throw new UnsupportedRunOperationError("Workflow agent steps not supported on CloudAgent yet (D244).");
  }
  const prompt = typeof step.promptTemplate === "string" ? step.promptTemplate : step.promptTemplate(input);
  const exec = async () => {
    const run = await step.agent.send(prompt, { signal: ctx.signal });
    const result = await run.wait();
    if (result.status === "finished") return result.result;
    if (result.status === "error") throw result.error ?? new Error("agent.send errored");
    throw new Error(`Unexpected agent status: ${result.status}`);
  };
  const { value, attempts } = step.retry !== undefined
    ? await withRetry(exec, step.retry, ctx.signal)
    : { value: await exec(), attempts: 1 };
  return { stepId: step.id, kind: "agent", status: "completed", attempts, durationMs: Date.now() - startedAt, output: value };
}
```

#### Tasks
1. CloudAgent guard via `UnsupportedRunOperationError`.
2. `signal` passthrough para `agent.send`.
3. Promptemplate function-shape valida que retorna string.

#### TDD
```
RED:
  - agent_step_cloudagent_throws_unsupported
  - agent_step_promptTemplate_function_invoked_with_input
  - agent_step_propagates_signal_to_agent_send
  - agent_step_with_retry_records_attempts
  - agent_step_throws_on_run_error_status
GREEN: implement
VERIFY: pnpm test tests/workflow/step-agent.test.ts
```

#### Acceptance Criteria
- [ ] 5 tests verde.

#### DoD
- [ ] Tests verde.

---

## Phase 8: Examples + telegram-pro integration

**Objective:** Shipear example `examples/workflows/` + `/workflow_demo` command no telegram-pro + atualizar docs.md.

### T8.1 — `examples/workflows/` example

#### Files to edit
```
examples/workflows/package.json (NEW — file:../../packages/sdk)
examples/workflows/.env.example (NEW)
examples/workflows/run.ts (NEW — refund pipeline demo)
examples/workflows/README.md (NEW)
```

#### Deep Dives

**run.ts** demonstra 4 primitives core:

```typescript
import { Agent, Workflow, fn, agentStep } from "@theokit/sdk";

const classifier = await Agent.create({ /* ... */ });
const billingExpert = await Agent.create({ /* ... */ });

const refundPipeline = Workflow.create({ name: "refund-pipeline" })
  .then(fn("validate", async (input: { claimId: string }) => {
    if (!input.claimId) throw new Error("missing claimId");
    return { claimId: input.claimId, valid: true };
  }))
  .then(agentStep("classify", classifier, (input) => `Classify refund: ${JSON.stringify(input)}`))
  .branch([
    [
      (input: any) => input.includes("billing"),
      [agentStep("billing-resolve", billingExpert, "Handle billing refund")],
    ],
  ], { fallback: [fn("generic-resolve", async () => ({ status: "escalated" }))] })
  .commit();

const run = await refundPipeline.run({ claimId: "CL-123" });
console.log("status:", run.status, "output:", run.output);
```

#### Tasks
1. Criar example com refund pipeline.
2. README explica 4 primitives demonstrados + how to run (Ollama + OpenRouter).
3. Documentar limitação D244 (cloud).

#### TDD
```
N/A — example. Verificação manual: `pnpm run run` com OPENROUTER_API_KEY em verde.
```

#### Acceptance Criteria
- [ ] `pnpm -F workflows-example run run` completa sem erro com `OPENROUTER_API_KEY`.
- [ ] README cobre setup + 3 primitives.

#### DoD
- [ ] Real-LLM run validado (regra `.claude/rules/real-llm-validation.md`).

---

### T8.2 — `/workflow_demo` command em telegram-pro

#### Files to edit
```
examples/telegram-pro/src/index.ts (MODIFY — adicionar /workflow_demo command + entry em /help)
.claude/skills/dogfood/lib/dogfood.mjs (MODIFY — adicionar /workflow_demo à suite)
```

#### Deep Dives

```typescript
// In index.ts ~line 1540 (after /handoff_demo):
runner.command("workflow_demo", async (event) => {
  if (event.platform !== "telegram") return;
  const ctx = event.telegram.raw as Context;
  const match = event.text.replace(/^\/\S+\s*/, "");
  const goal = match.trim();
  if (goal.length === 0) {
    await ctx.reply([
      "Usage: /workflow_demo <goal>",
      "",
      "Runs a 3-step workflow: classify intent → fan-out to 2 sub-tasks → summarize.",
    ].join("\n"));
    return;
  }
  await ctx.replyWithChatAction("typing");
  const { Agent, Workflow, fn, agentStep } = await import("@theokit/sdk");

  const classifier = await Agent.create({ /* ... */ });
  const summarizer = await Agent.create({ /* ... */ });
  try {
    const wf = Workflow.create({ name: "telegram-demo" })
      .then(agentStep("classify", classifier, (input: any) => `Classify intent: ${input.goal}`))
      .parallel([
        [fn("analyze-A", async (input) => ({ aspect: "feasibility", input }))],
        [fn("analyze-B", async (input) => ({ aspect: "cost", input }))],
      ])
      .then(agentStep("summarize", summarizer, (input) => `Summarize: ${JSON.stringify(input)}`))
      .commit();
    const run = await wf.run({ goal });
    await ctx.reply([
      `Workflow demo (D230-D248):`,
      `Status: ${run.status}`,
      `Steps: ${run.stepResults.length}`,
      `Final: ${String(run.output).slice(0, 2000)}`,
    ].join("\n"));
  } catch (err) {
    await ctx.reply(`/workflow_demo error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await classifier.dispose();
    await summarizer.dispose();
  }
});
```

**Dogfood suite entry:**

```javascript
{
  text: "/workflow_demo evaluate adding GraphQL",
  expect: [/Workflow demo|Status:|step/i],
  waitMs: 60000,
  retryOnError: true,
},
```

#### Tasks
1. Adicionar `/workflow_demo` command.
2. Adicionar entry em `/help` listing.
3. Atualizar dogfood suite.

#### TDD
```
N/A — integration validated by dogfood.
```

#### Acceptance Criteria
- [ ] `/workflow_demo` responde em < 60s.
- [ ] Dogfood suite passa (incluindo `/workflow_demo`).

#### DoD
- [ ] Dogfood: 44/45 PASS, 0 FAIL, 1 SKIP (HONCHO).

---

### T8.3 — `docs.md` Workflow section

#### Files to edit
```
docs.md (MODIFY — adicionar ## Workflows (v1.17+) section após ## Agent handoffs)
README.md (MODIFY — adicionar Workflow bullet em DEEP DIVE)
```

#### Deep Dives

Seção mínima cobrindo:
- `Workflow.create({ name }).then(...).commit().run(input)`
- Cada primitive com 5-10-line snippet
- RetryPolicy shape
- Suspend/resume
- Limitação D244 (LocalAgent only)

#### Tasks
1. Append section a `docs.md`.
2. README bullet em DEEP DIVE.

#### Acceptance Criteria
- [ ] `docs.md` tem seção `## Workflows (v1.17+)`.
- [ ] Cada primitive documentado.

#### DoD
- [ ] Commit verde.

---

## Phase 9: Dogfood QA (MANDATORY)

**Objective:** Validar que `Workflow.create + .run + .resume` funciona end-to-end no telegram-pro com LLM real.

### Execution

```bash
# 1. Rebuild SDK + refresh telegram-pro link
pnpm -F @theokit/sdk build
PNP_DIR=examples/telegram-pro/node_modules/.pnpm/@theokit+sdk@*/node_modules/@theokit/sdk
rm -rf $PNP_DIR/dist && cp -r packages/sdk/dist $PNP_DIR/dist

# 2. Restart bot fresh
ps aux | grep tsx.*telegram-pro | awk '{print $2}' | xargs -r kill -9
cd examples/telegram-pro && nohup pnpm tsx --env-file=.env src/index.ts > /tmp/tgpro-wf.log 2>&1 & disown
sleep 12 && grep "Connected as" /tmp/tgpro-wf.log

# 3. Full dogfood
cd /home/paulo/Projetos/usetheo/theokit-sdk
node .claude/skills/dogfood/lib/dogfood.mjs --user-id 7528967933
```

### Acceptance Criteria

- [ ] Total: 45 commands. **PASS: 44+. FAIL: 0.** SKIP: 1 (HONCHO_API_KEY expected).
- [ ] `/workflow_demo evaluate ...` retorna `Status: completed` em ≤ 60s.
- [ ] Spans `workflow.run` + `workflow.step.<id>` visíveis se OTel ativo (visual inspection).
- [ ] Zero CRITICAL no relatório dogfood.

### Runtime-metric proof

- `WorkflowRun.stepResults.length` ≥ 3 em uma run real do `/workflow_demo`.
- `StepResult.attempts` reflete retry count (verificar via stress-test com retryable fn).
- OTel span attribute `step.attempt: 2` observado quando retry dispara (real workload, não só unit test).

### If Dogfood Fails

1. Identificar issue específico (NÃO regressão de outros comandos).
2. Fix root cause (não loosen regex).
3. Re-run.

---

## Coverage Matrix

| # | Gap / Requisito | Task(s) | Resolução |
|---|---|---|---|
| 1 | Pipeline declarativo (Mastra parity) | T1.2, T2.1 | `.then` + `.parallel` shipados |
| 2 | Conditional routing | T3.1 | `.branch` com predicates + fallback |
| 3 | Map sobre array | T3.2 | `.foreach` com concurrency cap |
| 4 | Loop até cond | T3.3 | `.dowhile` com maxIterations safety |
| 5 | Wait / pause | T2.1 (sleep), T5.2 (suspend) | `.sleep` + `.suspend` |
| 6 | Retry com backoff | T4.1 | `withRetry` Temporal-shape |
| 7 | Cancellation | T2.1, T5.2 | AbortSignal at step boundaries |
| 8 | Persistence + resume | T5.1, T5.2 | InMemory + JSON stores + `Workflow.resume` |
| 9 | Telemetry | T6.1 | OTel spans lazy-loaded |
| 10 | Agent integration | T1.2 (helper), T7.1 (executor) | `agentStep()` + cloud guard |
| 11 | Type safety end-to-end | T1.1 | Zod schemas + discriminated union |
| 12 | Documentação | T8.3 | docs.md + README |
| 13 | Example real | T8.1 | `examples/workflows/refund-pipeline` |
| 14 | Integration validada (LLM real) | T8.2, Phase 9 | `/workflow_demo` + dogfood |
| 15 | Single-flight per runId | T2.1 | `single-flight.ts` (mirror D213) |
| 16 | Error isolation per branch | T2.1 (parallel) | `errorPolicy: fail-fast \| collect` |
| 17 | Step ID grammar | T1.2 | `sanitizeIdentifier` D81 reuse |
| 18 | Workflow ADRs persistidos | T0.1 | D230-D248 (19 ADRs) |
| 19 | Architecture snapshot pre/post | T0.2 + Phase 9 follow-up | `architecture/workflow/` |
| 20 | Saga (deferido) | D238 (ADR) | Slot reservado, NOT_IMPLEMENTED em v1 |
| 21 | Cloud agent guard | T7.1 | `UnsupportedRunOperationError` D244 |

**Coverage: 21/21 gaps covered (100%)**

## Global Definition of Done

- [ ] Todas as 9 phases completed.
- [ ] Todos os tests passing (target: 60+ novos tests workflow).
- [ ] Zero biome warnings em `packages/sdk/src/internal/workflow/` e `packages/sdk/src/workflow.ts`.
- [ ] `pnpm typecheck` verde.
- [ ] Build CJS+ESM+DTS verde.
- [ ] Backward compat: zero quebra em `Agent.create` / `Eval.create` / `Handoff.create` / `Cron.create`.
- [ ] 19 ADRs registradas em `.claude/knowledge-base/adrs/D230-*` a `D248-*`.
- [ ] `CLAUDE.md` Adoption Roadmap entry #5 marcado ✅ DONE com data.
- [ ] `CHANGELOG.md` entry em `packages/sdk/CHANGELOG.md` sob `[Unreleased]`.
- [ ] `docs.md` seção Workflows.
- [ ] `examples/workflows/` real-LLM validated.
- [ ] **Dogfood QA PASS** — 44+/45 PASS, 0 FAIL, 1 SKIP (HONCHO).
- [ ] **Runtime-metric proof** — `StepResult.attempts > 1` observado em real retry scenario; `WorkflowRun.stepResults.length > 1` em `/workflow_demo`.

## Final Phase: Dogfood QA (MANDATORY)

> Esta fase roda DEPOIS de todas as 9 phases. Plano NÃO está done sem dogfood.

**Objective:** Validar que `Workflow` funciona como user real experiencia.

### Execution

```bash
node .claude/skills/dogfood/lib/dogfood.mjs --user-id 7528967933
```

### Acceptance Criteria

- [ ] Total ≥ 45 commands (após `/workflow_demo` adicionado).
- [ ] PASS ≥ 44.
- [ ] FAIL = 0.
- [ ] SKIP ≤ 1 (HONCHO_API_KEY ausente é expected).
- [ ] Zero CRITICAL introduzidos.

### If Dogfood Fails

1. Identificar se issue é causado pelo plano (workflow code) vs pre-existing (Ollama latency etc).
2. Fix root cause workflow issues.
3. Re-run.
4. Pre-existing issues documentados mas não bloqueiam DONE.
