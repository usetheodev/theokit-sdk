# Plan: Production-Readiness — TheoKit Cross-Repo Handoff (6 Gaps)

> **Version 1.0** — Implementa os 6 gaps de production-readiness apontados pelo handoff `docs/handoffs/from-theokit/2026-05-25-production-readiness.md`: (1) `ConversationStorageAdapter` plugável para destravar deploys serverless (Vercel/CF Workers) e multi-host (K8s, TheoCloud); (2) `Agent.registry` com LRU + idle GC para eliminar OOM em servidores 24/7; (3) `AgentRunError` discriminado por `code` finito + `retriable` + `retryAfterMs` para UX de erro decente; (4) hooks `onToolStart/End/Error` em `AgentOptions` para audit log e cost tracking; (5) propagação real de `AbortSignal` até o LLM HTTP client (a infra existe, só está unwired no `send()` end-to-end); (6) hooks `onBeforeCreate`/`onBeforeSend` para quota multi-tenant. Cada gap entra como minor incremental em `next` tag, zero breaking changes, validação cross-repo contra `examples/openrouter-demo` da TheoKit antes do publish. Fonte de evidência: `docs/handoffs/from-theokit/2026-05-25-production-readiness.md` (lido linha-a-linha 2026-05-25). Ordem de ship: 1 → 2 → 3 → 5 → 4 → 6 (1+2 são infra que tudo depende; 3 destrava observabilidade; 5 é HTTP wiring que já tem infra; 4+6 são quality-of-life).

## Context

**Estado atual do SDK (2026-05-25):**

- **Persistência de sessão (Gap 1):** `internal/runtime/agent-session-store.ts` escreve hard-coded em `<cwd>/.theokit/agents/<id>/messages.jsonl` via `node:fs/promises`. `agent-session.ts` mantém cache in-process + chained per-(agent,cwd) queue. **Sem indireção** — se rodar em CF Workers, crash no `appendFile`. Em Vercel `/tmp` evapora entre invocations. Em K8s replicas, mesmo `userId` cai em pods diferentes e enxerga histórias diferentes. Evidência grep: `grep -rn "messages.jsonl\|.theokit/agents" packages/sdk/src` → 9 referências em 6 arquivos, todas hard-coded.

- **Registry (Gap 2):** `internal/runtime/agent-registry.ts` mantém `Map<agentId, RegisteredAgent>` global no processo. **Sem GC nenhum** — `agents.set()` é monotônico até `clearAgentRegistry()` ser chamado. Cada `Agent.getOrCreate(userId)` em servidor multi-tenant adiciona uma entry. 10 novas conversation IDs/min × 24h = ~14.400 entries acumuladas, cada uma carregando `RegisteredAgent.options` (custom tools, plugins, providers, system prompt). TheoKit tem GC dev-mode no `theokit dev`, mas em `theokit start` (production) nada evicta. **Garantido OOM** em servidores 24/7.

- **Erros (Gap 3):** `AgentRunError` já existe e já carrega `code`/`provider`/`raw`/`metadata` (ver `errors.ts:207-231`). `ErrorCode` enum tem 10 valores (`rate_limit`, `auth_failed`, `invalid_request`, `timeout`, `server_error`, `context_too_long`, `content_filtered`, `model_unavailable`, `network`, `unknown`). **O que falta:** (a) `quota_exceeded`, `tool_runtime_error`, `aborted` — três codes pedidos pelo handoff que não existem; (b) `retriable: boolean` exposto no top-level (hoje só `isRetryable` no base class — alias ambíguo); (c) `retryAfterMs` em milissegundos (hoje só `metadata.retryAfter` em segundos, inconsistente com `Date.now()`); (d) `requestId` provider-side; (e) `conversationId` SDK-side; (f) mapping table cross-provider visível em `docs/error-codes.md`. Mappers existem por provider em `internal/errors/mappers/{anthropic,openai-compatible,bedrock,vertex,ollama}.ts` (ADR D67) — base sólida para expandir.

- **Tool lifecycle (Gap 4):** Plugin hook system tem `pre_tool_call` (D101 veto) + `post_tool_call` (observação). Mas é **plugin-shaped** — força o consumidor a criar um `definePlugin({kind:"general", register})` para um simples spy. TheoKit precisa de algo direto em `AgentOptions`. Plus: o `callId` (unique invocation marker) **não existe** no contrato — `DispatchResult.callId` é o tool_use_id do LLM mas não é propagado para hooks.

- **AbortSignal streaming (Gap 5):** `SendOptions.signal` JÁ existe em `types/run.ts:149`, mas o JSDoc diz literalmente: *"the LLM HTTP call itself is NOT cancellable mid-stream — same constraint as Agent.batch (ADR D140)"*. **PORÉM** os clients LLM em `internal/llm/{openai,anthropic,bedrock-anthropic,vertex-anthropic}.ts` JÁ aceitam `signal: AbortSignal` na assinatura e passam pra `fetch({ signal })`. A infra existe — falta wiring no `local-agent`/`real-local-run`. Evidência grep: `grep -rn "signal: AbortSignal" internal/llm/` → 6 clients aceitam, mas nenhum recebe do `SendOptions.signal` na call chain de produção.

- **Quota hooks (Gap 6):** Não existem. TheoKit hoje teria que enforce no nível de route Express, mas o SDK API já tem `Agent.create({ agentId })` chamado em background por workers, schedules, etc — fora do controle da route. Hook no SDK é onde captura tudo.

**Por que agora:**

TheoKit acabou de shipar `system-100-percent-functional` (v0.2.0 candidate) com 2608 tests verde, 92/100 no dogfood. **Mas** o framework não pode ir GA enquanto serverless está broken (gap 1+5) e multi-host produz OOM em 24h (gap 2). Esses 3 são bloqueadores P0 para o roadmap de TheoCloud — o destino comercial principal. Gaps 3/4/6 são P1 (UX + observabilidade + multi-tenant) que tornam o produto "production-grade" no sentido pleno, não só "funciona em demos".

**Princípios não-negociáveis (do CLAUDE.md raiz + cross-repo):**

1. **Sem breaking changes.** Todo campo novo é opt-in com default sensato. App existente sem configurar nada continua funcionando byte-idêntico.
2. **Real-LLM validation.** Cada gap whose code path inclui `agent.send()` DEVE rodar com chave real antes de "validado" — fixture mode + typecheck NÃO contam (regra `.claude/rules/real-llm-validation.md`).
3. **No stubs/mocks em produção.** Adapters de Postgres/Redis vão como **recipes em docs/**, não como deps in-core (regra `.claude/rules/no-stubs-no-mocks-no-wired.md`).
4. **Dogfood gate.** Cada phase termina com `examples/telegram-pro` rodando o regression /dogfood (CDP) PASS antes de avançar. Pre-existing telegram-pro count atual: 44/44 PASS.

## Objective

**Done = TheoKit pode anunciar honestamente "production-grade para serverless e multi-host" e o `theo-cloud` deploy adapter milestone fica desbloqueado.** Operacionalmente isso significa, em ordem:

1. **Gap 1 shipped** — `@theokit/sdk` exporta `ConversationStorageAdapter` interface + `InMemoryConversationStorage` + `FileSystemConversationStorage` (default). Postgres + Redis recipes em `docs/recipes/`. `AgentOptions.conversationStorage` opcional propaga até o lugar onde hoje `appendToSessionFile` é chamado direto.
2. **Gap 2 shipped** — `Agent.registry.configure({ maxAgents, idleTimeoutMs, onEvict })` controla LRU + idle eviction. `Agent.registry.evict(id)` / `evictAll()` / `size()` / `ids()`. `agent.dispose()` chamado em cada eviction. Default seguro: `maxAgents: 100`, `idleTimeoutMs: 30min`.
3. **Gap 3 shipped** — `AgentRunError` carrega `code: AgentRunErrorCode` (11 valores), `retriable: boolean`, `retryAfterMs?: number` (computed dos mappers), `requestId?: string`, `conversationId?: string`. `providerError` disponível mas NÃO em `.message` (regra anti-leak). Cross-provider mapping documentado em `docs/error-codes.md`.
4. **Gap 5 shipped** — `send(message, { signal })` propaga até `fetch({ signal })` na chamada provider. Quando abortado: HTTP request real cancelada (não só Promise rejeitada), nenhum partial assistant message persiste em storage, throw `AgentRunError({ code: "aborted", retriable: false })`.
5. **Gap 4 shipped** — `AgentOptions.onToolStart`, `onToolEnd`, `onToolError` callbacks. Cada par start/end share o mesmo `callId`. `durationMs` medido entre start do handler e end/error. Hook errors são swallowed (não interrompem run); `onToolError` fires ANTES do DispatchResult ser entregue.
6. **Gap 6 shipped** — `AgentOptions.onBeforeCreate`, `onBeforeSend`. Erros NÃO swallowed (esses são blockers, não observers). Rodam ANTES de qualquer side effect (provider call, storage write).
7. **Dogfood QA pass** — `examples/telegram-pro` /dogfood (CDP) 44/44 sem regressão pós-Phase 6.
8. **Cross-repo smoke** — bumped pre-release em TheoKit's `examples/openrouter-demo` faz send/wait/dispose com Postgres recipe e cancela mid-stream sem leak de token.

## ADRs

> Numeração começa em D303 (último em uso: D302 — Bedrock streaming deferred). Cada ADR vai ter arquivo dedicado em `.claude/knowledge-base/adrs/` quando a phase for shipada.

### Gap 1 — ConversationStorageAdapter

- **D303 — `ConversationStorageAdapter` é interface pública exportada de `@theokit/sdk`, NÃO de um sub-export.**
  *Rationale:* O contrato é central para qualquer consumidor sério (TheoKit, futuros frameworks). Sub-export `@theokit/sdk/conversation` quebra discoverability — devs precisam saber que existe pra importar. Main barrel é o ponto de entrada esperado. Sub-exports do SDK até hoje (D24 Zod, D43 LanceDB, sub-export `/tools` e `/path-safety`) seguem regra: sub-export quando feature opcional + dep peer carrega payload material. Interface puro de tipos não pesa nada.
  *Consequences:* enables descoberta natural via autocomplete; constrains: rename futuro do método requer major bump (não problema — interface é de 5 métodos, estabilidade alta).

- **D304 — `FileSystemConversationStorage` é o default zero-config; `InMemoryConversationStorage` é primary para tests.**
  *Rationale:* Backward compat absoluta. App existente sem `conversationStorage` continua escrevendo em `.theokit/agents/<id>/messages.jsonl` sem mudar nada. Default FS é o que 100% dos usuários atuais já assumem. `InMemoryConversationStorage` é necessário para tests da SDK e para users que querem ephemeral state em dev/CLI single-process.
  *Consequences:* enables zero-migration upgrade; constrains: FS adapter precisa ser refactor-safe — não pode regredir performance ou semantics de crash-safe-line-granularidade que o JSONL atual tem.

- **D305 — Postgres + Redis adapters ficam em `docs/recipes/` como user code, NÃO em `@theokit/sdk`.**
  *Rationale:* Manter SDK dep-light. `pg` traz prepared statement infra de ~500KB; `ioredis` ~300KB. Não-justificado para uma feature que 30% dos users vão precisar (self-hosted Node single-VPS continua FS-bound). Pattern: documentar interface, mostrar exemplo, deixar consumer copiar+pastear. Compatível com D170 (gateway-* como peer dep packages) e D11 (embedding adapters como peer-dep workspace packages quando carregam módulos sérios — mas storage adapter é trivial: 30 linhas).
  *Consequences:* enables SDK <50KB bundle; constrains: TheoKit e consumers que querem typed Postgres adapter copiam o template. Trade-off aceitável (validado contra Vercel AI SDK que segue o mesmo padrão em `examples/`).

- **D306 — Interface usa `Promise<>`-returning métodos uniformemente, mesmo quando subjacente é síncrono (in-memory).**
  *Rationale:* Polimorfismo limpo. Mistura sync/async no contrato força callers a `await` defensivo de qualquer modo. `Promise.resolve(value)` para in-memory custa 1 microtask — não-issue.
  *Consequences:* enables single call-site para qualquer adapter; constrains: in-memory adapter perde 1 microtask por op (aceitável dado que hot path real é fs/network).

### Gap 2 — Agent.registry GC

- **D307 — `Agent.registry` é uma NOVA classe separada do `agent-registry.ts` interno existente.**
  *Rationale:* O `agent-registry.ts` interno guarda **metadata** (RegisteredAgent: agentId+options+createdAt) persistida em `registry.json`. Esse é o "address book" do SDK e não tem nada a ver com OOM. O OOM mora em **instâncias vivas** de `SDKAgent` que TheoKit precisa cachear cross-request para evitar `LocalAgent.initialize()` (MCP boot, plugin load, etc) a cada hit. Misturar os dois conceitos viola SRP. Novo módulo: `internal/runtime/live-agent-registry.ts` com `Map<agentId, { agent: SDKAgent, lastUsedAt: number }>`.
  *Consequences:* enables separação clara (metadata vs liveness); constrains: dois Maps no processo (cheap — agents typicamente <100), mas docs.md deve diferenciar `agent-registry.ts` interno e o público `Agent.registry`.

- **D308 — Defaults: `maxAgents: 100`, `idleTimeoutMs: 1_800_000` (30 min), sweep interval 60s.**
  *Rationale:* Calibrado pra indie/small-team Node deploys (single VPS, hobby project). 100 agents × ~5MB cada = ~500MB working set, dentro do envelope típico de Heroku/Railway/Render free tiers. 30min idle pega usuários que voltam após coffee break sem evictar; agressivo o suficiente pra não acumular. Sweep 60s é o middle-ground entre responsiveness (1s = CPU waste) e efetividade (10min = stale OOM).
  *Consequences:* enables zero-config sane production; constrains: high-traffic SaaS deve `configure({ maxAgents: 1000 })` ou rodar com `maxAgents: 0` (cache off, sempre re-initialize). Docs explicam ambos os modos.

- **D309 — Eviction triggers `agent.dispose()` mas catch+swallow do disposal error.**
  *Rationale:* Eviction não é o ponto certo para crashar — o lifecycle do agent é independente do cache. Se `dispose()` lança (MCP server stuck, etc.), logar em stderr (`[theokit-sdk] dispose during eviction failed`) e continuar evictando os outros. Aborting o eviction por causa de um dispose ruim só piora o problema (memory continua, plus disposal não-feito acumula).
  *Consequences:* enables eviction confiável em produção real; constrains: bugs sutis em dispose podem mascarar (mitigation: `onEvict` listener vê todos os IDs, telemetry pode aggregar).

- **D310 — `Agent.registry.configure()` é "last config wins" (process-wide singleton), NÃO per-Agent.**
  *Rationale:* Live cache só faz sentido global no processo — uma Agent dispondo do cache "dela" mas outra escolhendo "no cache" cria bug de inconsistência. Match com pattern do `CredentialPool` (D123) e `Cron` (D7) que são process-wide.
  *Consequences:* enables raciocínio simples; constrains: testes precisam `Agent.registry.evictAll()` no `beforeEach` (já é o pattern para `clearAgentRegistry()` interno).

### Gap 3 — AgentRunError discriminated

- **D311 — `ErrorCode` (existente) e `AgentRunErrorCode` (novo) convivem; `AgentRunErrorCode` é union estrita do que aparece em `AgentRunError.code`.**
  *Rationale:* `ErrorCode` foi desenhado em D66 como union finito de codes de erro de provider HTTP (10 valores). Bom — não derruba. Mas o handoff pede 3 codes adicionais que NÃO são provider-originated: `tool_runtime_error` (handler throw), `aborted` (signal), e `quota_exceeded` que é semanticamente provider mas precisa estar disponível pra usuário branchear. Criar `AgentRunErrorCode` = `ErrorCode | "quota_exceeded" | "tool_runtime_error" | "aborted"` mantém retrocompat e dá exhaustive check em consumers.
  *Consequences:* enables exhaustive `switch` em consumers; constrains: novos codes futuros entram em `AgentRunErrorCode` primeiro, e migram pra `ErrorCode` se forem provider-originated.

- **D312 — `retryAfterMs` é getter computado em cima de `metadata.retryAfter` (segundos).**
  *Rationale:* Mappers (`internal/errors/mappers/shared.ts`) já parseiam `Retry-After` header em segundos e gravam em `metadata.retryAfter`. Renomear quebra D67 + todos os 5 mappers. Adicionar getter `get retryAfterMs(): number | undefined { return this.metadata?.retryAfter !== undefined ? this.metadata.retryAfter * 1000 : undefined; }` zero-cost e mais ergonômico (combina com `Date.now()`/`setTimeout`).
  *Consequences:* enables ergonomia; constrains: usuário que muda `metadata.retryAfter` após criação não vê reflect (esperado — error é imutável).

- **D313 — `providerError` é APENAS no `metadata.raw` (já existe); NÃO duplicar campo top-level.**
  *Rationale:* `metadata.raw` já carrega o response body truncado a ~2KB (D65). Handoff pede `providerError?: unknown` top-level — mas adicionar duplica info e arrisca quebra de redaction (D68). Aliasar via getter: `get providerError(): unknown { return this.metadata?.raw; }`. Mantém invariante "secrets nunca em `.message`".
  *Consequences:* enables compat; constrains: docs.md deve clarificar "providerError = metadata.raw".

- **D314 — Mapping table OpenAI/Anthropic/OpenRouter é o gate; Vertex/Bedrock/Ollama herdam por extension.**
  *Rationale:* OpenAI + Anthropic cobrem ~95% dos consumers atuais (medido pelo provider mix dos examples). OpenRouter delega normalize. Vertex e Bedrock são wrappers (D291, D292) que reusam o OpenAI/Anthropic mapper. Ollama tem mapper próprio mas só erra por timeout/network. Foco no path quente primeiro.
  *Consequences:* enables coverage mais rápido; constrains: providers menores podem ter `code: "unknown"` em casos raros (acceptable — caller branchea em `unknown` como fallback).

### Gap 4 — Tool lifecycle hooks

- **D315 — `onToolStart`/`onToolEnd`/`onToolError` em `AgentOptions`, NÃO em plugin context.**
  *Rationale:* Handoff diz literalmente "TheoKit's `trackAgentRun` wants to accumulate per-tool metrics". Forçar plugin é overkill para um spy de telemetria. Pattern: callback direto em `AgentOptions` (matches Vercel AI's `onChunk`/`onFinish`, OpenAI SDK's events). Internamente, esses callbacks são registrados como wrappers em torno de `pre_tool_call`/`post_tool_call` hooks já existentes — reuse de infra.
  *Consequences:* enables ergonomia + nenhuma nova infra de hook; constrains: callback errors swallowed (não-bloqueante, é observação).

- **D316 — `callId` propagado: unique por invocação, idêntico em start/end pair.**
  *Rationale:* `DispatchResult.callId` JÁ é o tool_use_id do LLM (estável durante o lifecycle do call). Reusar. Plus garantia: se 2 calls do mesmo tool em paralelo (raríssimo mas LLM pode), cada um tem callId distinto.
  *Consequences:* enables correlação start↔end em logs; constrains: callers que persistirem callId em DB devem usar como string opaca (não interpretar formato).

- **D317 — Hook errors são swallowed via `try/catch` em volta do callback; warn em stderr.**
  *Rationale:* Listener crash não pode quebrar `agent.send()`. Match com pattern do plugin manager (D101 — hook handler errors logged, never propagated). stderr warn: `[theokit-sdk] onToolStart listener threw: <msg>`.
  *Consequences:* enables hardening; constrains: bugs silenciosos em listeners (mitigation: warn é searchable).

### Gap 5 — AbortSignal end-to-end

- **D318 — `SendOptions.signal` propaga atravessando o agent loop até o `fetch({ signal })` no LLM client.**
  *Rationale:* A infra HTTP **já existe** em todos os LLM clients. O bloqueio é no wiring: `SendOptions.signal` para hoje em `pre_user_send` adapter hooks e não viaja além. Refactor: passar `signal` no `RunContext` interno que já flui handler→client. Zero novo módulo, só plumbing.
  *Consequences:* enables cancelamento real de tokens; constrains: handler de tool em vôo durante abort recebe o cleanup via `signal` também (best-effort — tool não custom-signal-aware ainda completa).

- **D319 — Compose user signal + internal lifecycle signal via `AbortSignal.any([user, lifecycle])`.**
  *Rationale:* User abort (req close) e SDK-internal abort (agent.dispose) precisam combinar. `AbortSignal.any()` é nativo em Node 20+ (já é minimum do SDK per D1) e em CF Workers / Vercel Edge.
  *Consequences:* enables cancel multi-source; constrains: Node <20 não suportado (alinhado com D1).

- **D320 — Partial assistant message NÃO persiste em conversationStorage quando abort dispara.**
  *Rationale:* Persistir parcial corrompe a história ("user: hi" → "assistant: hello wor..." vira a próxima turn). Match com OpenAI Chat Completions semantics: abort = nada salvo. Implementação: storage append só roda em `post_assistant_reply` hook (após mensagem completa). Aborto pula o append.
  *Consequences:* enables história limpa; constrains: telemetry quer ver partials (mitigation: telemetry vê via stream events, não via storage).

- **D321 — Abort throws `AgentRunError({ code: "aborted", retriable: false })`, NÃO uma `DOMException` raw.**
  *Rationale:* Consistency com o resto da hierarquia de erros do SDK. `DOMException` é o que `fetch()` joga; mapeamos no wrapper. `retriable: false` porque retry de abort é semanticamente errado (caller pediu pra parar).
  *Consequences:* enables `catch (err instanceof AgentRunError)` uniforme; constrains: `err.cause` carrega o DOMException original para debug.

### Gap 6 — Quota/abuse hooks

- **D322 — `onBeforeCreate`/`onBeforeSend` errors NÃO swallowed; propagam como rejection.**
  *Rationale:* Esses hooks são **gates de admissão**, não observers. Errors são intencionais (quota excedida). Match com pattern `pre_tool_call` veto (D101) onde decisão `{ block: true }` para a execução.
  *Consequences:* enables enforcement real; constrains: caller deve usar erro customizado meaningful (sugest `QuotaExceededError` extends `ConfigurationError`).

- **D323 — Hooks rodam ANTES de qualquer side effect (provider call, storage write, registry insert).**
  *Rationale:* Critical para idempotência. Se `onBeforeCreate` rejeita após persistir metadata em `registry.json`, ficou orphan. Order: validate → hook → side effects.
  *Consequences:* enables rejection limpa; constrains: hook não pode usar dados que só existem pós-create (acceptable — quota é input-side).

## Dependency Graph

```
Phase 0: Architecture snapshot + scaffolding
   │
   ▼
Phase 1: Gap 1 — ConversationStorageAdapter (CRITICAL)
   │
   ▼
Phase 2: Gap 2 — Agent.registry LRU/idle GC (CRITICAL)
   │
   ▼
Phase 3: Gap 3 — AgentRunError codes ──────┐
   │                                       │ (Phase 3 + Phase 4 podem
   ▼                                       │  acontecer em paralelo
Phase 4: Gap 5 — AbortSignal end-to-end ───┤  após Phase 2)
   │                                       │
   └───────────┬───────────────────────────┘
               ▼
Phase 5: Gap 4 — Tool lifecycle hooks
   │
   ▼
Phase 6: Gap 6 — Quota/abuse hooks
   │
   ▼
Phase 7: Dogfood QA (telegram-pro + openrouter-demo cross-repo)
```

**Phases 3 e 4 podem rodar em paralelo** (são independentes de implementação — apenas Phase 3 consome o `aborted` code para emitir AgentRunError corretamente quando signal dispara; mas Phase 4 pode usar string `"aborted"` provisória e Phase 3 ratifica). Recomendação: serialize 3 → 4 para simplificar review, mas explicitly não-bloqueante.

**Phases 1 e 2 são sequenciais** porque o GC layer (Phase 2) consome o ConversationStorageAdapter (Phase 1) para `agent.dispose()` cleanup-on-eviction.

---

## Phase 0: Architecture Snapshot + Scaffolding

**Objective:** Capturar baseline do domain `persistence/runtime` antes de qualquer mudança, e definir contratos compartilhados entre as 6 phases.

### T0.1 — Architecture snapshot do domain `runtime`

#### Objective
Documentar o estado atual de `internal/runtime/` + `internal/persistence/` para comparação pós-implementação.

#### Evidence
Skill `to-plan` exige `architecture-docs {domain}` antes do plano alterar arquitetura. O domain `runtime` é onde 4 dos 6 gaps tocam (1, 2, 4, 5). O domain `errors` é onde gap 3 toca.

#### Files to edit
```
.claude/knowledge-base/architecture/runtime/  (NEW dir)
  ├── system-context.md          — caller → SDK boundaries
  ├── container-diagram.md       — Agent / Run / Session / Registry blocks
  ├── component-runtime.md       — internal/runtime/* mapped
  ├── component-persistence.md   — internal/persistence/* mapped
  └── deep-dive.md               — agent-session-store + agent-registry walkthrough
.claude/knowledge-base/architecture/errors/   (NEW dir)
  ├── system-context.md
  ├── container-diagram.md
  └── component-errors.md
```

#### Deep file dependency analysis
- Não muda código de produção; apenas docs.
- Output consumido por T7.1 (Dogfood) para diff before/after.

#### Deep Dives
- N/A (documentação)

#### Tasks
1. Rodar `find packages/sdk/src/internal/runtime -name "*.ts" | wc -l` para inventory size.
2. Para cada arquivo central (agent-session.ts, agent-session-store.ts, agent-registry.ts, agent-registry-store.ts, local-agent.ts, real-local-run.ts), produzir 1-paragraph descrição.
3. Diagrams ASCII (não SVG — manter simples).
4. Commit isolado: `docs(architecture): baseline runtime + errors before production-readiness plan`.

#### TDD
```
N/A — task é puramente de documentação.
```

#### Acceptance Criteria
- [ ] `.claude/knowledge-base/architecture/runtime/` populado com 5 arquivos
- [ ] `.claude/knowledge-base/architecture/errors/` populado com 3 arquivos
- [ ] Cada arquivo lista filenames + 1-line description (não cola código verbatim)

#### DoD
- [ ] Commit standalone com mensagem `docs(architecture): baseline ...`
- [ ] Plan T7 consegue rodar `diff` contra esses arquivos

### T0.2 — Inviolable constraints document

#### Objective
Documentar em um arquivo central os invariants que TODAS as phases precisam respeitar.

#### Evidence
CLAUDE.md cross-project rules + handoff section "Backward compatibility — non-negotiable". Sem doc compartilhado, cada phase reinventa a lista.

#### Files to edit
```
.claude/knowledge-base/plans/production-readiness-invariants.md  (NEW)
```

#### Deep file dependency analysis
- Referenciado por cada `### Acceptance Criteria` das phases 1-6.
- Não muda código.

#### Tasks
1. Listar invariants:
   - Zero breaking changes (todo novo campo opt-in default-safe).
   - Existing examples (`telegram-pro`, `slack-bot`, `whatsapp-bot`, `email-bot`) continuam passando sem alteração.
   - Real-LLM validation required quando `agent.send()` está no path.
   - `CHANGELOG.md` entry sob `[Unreleased]` por phase shipada.
   - `docs.md` section update por phase shipada.
   - Telegram-pro /dogfood 44/44 sem regressão entre phases.
2. Commit standalone.

#### TDD
N/A.

#### Acceptance Criteria
- [ ] Arquivo criado com 6 invariants explicitados
- [ ] Linkado a partir do plano principal (essa seção)

#### DoD
- [ ] Pronto pra ser citado em CI gate `pnpm validate`

---

## Phase 1: Gap 1 — `ConversationStorageAdapter`

**Objective:** Substituir o acesso direto ao filesystem em `agent-session-store.ts` por uma interface plugável, mantendo o comportamento default (FS) byte-idêntico.

### T1.1 — Interface pública `ConversationStorageAdapter` + types

#### Objective
Definir o contrato exato do handoff (5 métodos, 2 opcionais) e exportar do barrel principal.

#### Evidence
Handoff section "Proposed contract" lista os 5 métodos. ADR D303 fixa a localização (main barrel, não sub-export).

#### Files to edit
```
packages/sdk/src/types/conversation-storage.ts  (NEW)
  — define ConversationStorageAdapter + ConversationStorageMessage
packages/sdk/src/index.ts                       (MODIFY)
  — re-exportar ConversationStorageAdapter type
packages/sdk/src/types/conversation.ts          (MODIFY)
  — re-exportar tipo para compatibility com SDKMessage shape
```

#### Deep file dependency analysis
- `types/conversation-storage.ts` (novo): puro tipo, zero side effects.
- `index.ts`: já barrel para todos os tipos públicos; uma linha nova.
- `types/conversation.ts`: tem `SDKMessage` que `ConversationStorageAdapter.appendMessage` consome — confirmar shape compatível ou criar `StoredMessage = Pick<SDKMessage, "role" | "content">`.

#### Deep Dives
- Shape de `SDKMessage` no SDK atual: `{ type: "user" | "assistant" | "system" | "tool_call" | ... }` (discriminated union por `type`, ~12 variantes).
- Persistência hoje é `PersistedSessionMessage = { role: "user"|"assistant", text: string, at: number }` (mais simples que SDKMessage).
- Decisão: interface usa `StoredMessage = { role: "user"|"assistant"|"system"|"tool_call"|"tool_result"; content: string; at?: number }`. Persistência futura pode expandir; current só persiste user/assistant.
- Invariants:
  - `getMessages` MUST retornar `[]` em conversation inexistente (nunca throw).
  - `appendMessage` MUST ser atômico — duas calls concorrentes não corrompem.
  - `deleteConversation` MUST ser idempotent (delete-of-missing = ok).

#### Tasks
1. Criar `types/conversation-storage.ts` com:
   ```ts
   export interface StoredMessage {
     role: "user" | "assistant" | "system" | "tool_call" | "tool_result";
     content: string;
     at?: number;
   }
   export interface ConversationStorageAdapter {
     getMessages(conversationId: string): Promise<readonly StoredMessage[]>;
     appendMessage(conversationId: string, message: StoredMessage): Promise<void>;
     deleteConversation(conversationId: string): Promise<void>;
     listConversationIds?(opts?: { limit?: number }): Promise<readonly string[] | undefined>;
     dispose?(): Promise<void>;
   }
   ```
2. Adicionar ambos os tipos ao `index.ts` (re-export).
3. Adicionar `AgentOptions.conversationStorage?: ConversationStorageAdapter` em `types/agent.ts`.

#### TDD
```
RED:     types_compile_no_change_to_existing_options() — assert que `AgentOptions` antes/depois é estruturalmente compatível
RED:     stored_message_shape_persists() — assert shape do StoredMessage não muda em refactor futuro
GREEN:   Criar arquivo + re-export
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk typecheck && pnpm --filter @theokit/sdk build
```

#### Acceptance Criteria
- [ ] `import { ConversationStorageAdapter, StoredMessage } from "@theokit/sdk"` compila
- [ ] `AgentOptions.conversationStorage?` aparece em autocomplete
- [ ] Zero arquivos existentes editados além do barrel + types/agent.ts
- [ ] `pnpm publint && pnpm attw` permanece 100% verde

#### DoD
- [ ] `pnpm --filter @theokit/sdk typecheck` passa
- [ ] Nenhum example breakou typecheck (`tools/typecheck-examples.sh`)

### T1.2 — `InMemoryConversationStorage` impl + tests

#### Objective
Implementação de referência rápida para tests + dev ephemeral.

#### Evidence
Handoff Tests block usa `InMemoryConversationStorage` no `describe.each([...])` contract suite. Bloqueia T1.4 (refactor) que precisa do adapter pra rodar tests.

#### Files to edit
```
packages/sdk/src/internal/persistence/conversation-storage-memory.ts  (NEW)
packages/sdk/tests/persistence/conversation-storage-memory.test.ts    (NEW)
packages/sdk/src/index.ts                                             (MODIFY — re-export)
```

#### Deep file dependency analysis
- Nenhum import de runtime; só `Map<string, StoredMessage[]>`.
- Re-exportado do barrel para uso direto: `import { InMemoryConversationStorage } from "@theokit/sdk"`.

#### Deep Dives
- Concurrent safety: Node single-thread, `Map.set` é atômico, append a array é atômico, OK sem mutex.
- `listConversationIds` retorna `Map.keys()` slice — implementa o método (deferido só nos casos de provedores que cannot enumerate).
- `dispose` é no-op (nada pra fechar).

#### Tasks
1. Implementar classe `InMemoryConversationStorage implements ConversationStorageAdapter`.
2. Suíte de tests: 5 cases do handoff (returns [] for unknown, creates lazily, preserves order, concurrent appends 50x, delete idempotent).
3. Plus 2 edge cases: (a) `getMessages` retorna readonly slice (mutação no array retornado NÃO afeta storage), (b) `listConversationIds({ limit: 2 })` respeita limit.

#### TDD
```
RED:     test_get_empty_for_unknown_id()
RED:     test_append_creates_conversation_lazy()
RED:     test_preserves_insertion_order()
RED:     test_concurrent_50_appends_no_corruption()
RED:     test_delete_idempotent()
RED:     test_getMessages_returns_defensive_copy()
RED:     test_listConversationIds_respects_limit()
GREEN:   Implementar InMemoryConversationStorage (7 tests passam)
REFACTOR: Extrair helper `cloneArray` se houver dup
VERIFY:  pnpm --filter @theokit/sdk test -- conversation-storage-memory
```

#### Acceptance Criteria
- [ ] 7/7 tests pass
- [ ] Cobertura ≥ 95% no arquivo (cyclomatic baixo)
- [ ] Zero deps externos
- [ ] Compatível com `await using` (`dispose?` opcional preenchido)

#### DoD
- [ ] Tests verdes
- [ ] `pnpm --filter @theokit/sdk typecheck` passa
- [ ] Exportado do barrel

### T1.3 — `FileSystemConversationStorage` impl + tests

#### Objective
Encapsular o código existente em `agent-session-store.ts` num adapter que implementa `ConversationStorageAdapter`. Comportamento byte-idêntico ao atual.

#### Evidence
ADR D304 fixa FS como default. Comportamento atual (atomic append via `appendFile`, redaction via D68, compaction every 50 appends D18) NÃO pode regredir — telegram-pro depende disso (dogfood 44/44 baseline).

#### Files to edit
```
packages/sdk/src/internal/persistence/conversation-storage-fs.ts  (NEW)
  — wraps existing append/read/compact logic em classe
packages/sdk/src/internal/runtime/agent-session-store.ts          (KEEP existing pure functions but call from FS adapter)
packages/sdk/tests/persistence/conversation-storage-fs.test.ts    (NEW)
packages/sdk/src/index.ts                                         (MODIFY — re-export class)
```

#### Deep file dependency analysis
- `agent-session-store.ts` exporta `appendToSessionFile`, `readSessionFile`, `compactSessionFile` (pure functions internas, OK manter).
- Novo `conversation-storage-fs.ts` classe delega para essas funções (constructor recebe `cwd: string`).
- `agent-session.ts` (T1.4) vai consumir a interface, não as pure functions diretamente.

#### Deep Dives
- Constructor signature: `new FileSystemConversationStorage({ root?: string })` onde `root` default = `process.cwd()`. Match com `LocalAgent.options.local.cwd` semantics.
- `getMessages` chama `readSessionFile(this.root, conversationId)` e mapeia `SessionMessage → StoredMessage`.
- `appendMessage` chama `appendToSessionFile(this.root, conversationId, message)` (mapping inverse).
- `deleteConversation` é NOVA implementação: `rm -rf <root>/.theokit/agents/<id>/` via `rm({ recursive: true, force: true })`. Idempotent. **EC-1 (path-guard):** sanitizar conversationId com `sanitizeIdentifier(id, { maxLen: 128 })` + `safePathJoin(root, ".theokit", "agents", safeId)` ANTES do `rm`. Sem isso, `conversationId: "../../../tmp"` apaga fora do agents dir.
- `listConversationIds`: `readdir(<root>/.theokit/agents/)` filtrando por `agent-*` / `bc-*` prefix. **EC-2 (ENOENT):** `try { await readdir(...) } catch (e) { if (e.code === "ENOENT") return []; throw; }`. Sem isso, first run (dir not created yet) crasha.
- `dispose`: no-op (file handles fecham por GC; nada persistente além do fs).
- **Critical:** preservar redaction (D68) — `appendToSessionFile` já chama `redactSecrets` internamente. Adapter não duplica.

#### Tasks
1. Criar classe `FileSystemConversationStorage` em `conversation-storage-fs.ts`.
2. Implementar 5 métodos chamando pure functions existentes.
3. Adicionar mapping `SessionMessage → StoredMessage` (e inverse).
4. Tests: rodar a MESMA suíte de T1.2 contra FS adapter (parametric describe.each).
5. Plus 5 tests específicos FS:
   - Conversa em sub-path com path traversal attempt: throws `PathTraversalError`.
   - Append → read em processo restart simulado (clear in-memory map, hydrate from disk).
   - `deleteConversation` remove dir + arquivo.
   - **EC-1:** `deleteConversation("../../../tmp")` throws `PathTraversalError` (path-guard aplicado).
   - **EC-2:** `listConversationIds()` em workspace sem `.theokit/agents/` retorna `[]` (catch ENOENT, não throw).
   - **EC-10:** `appendMessage(id, { role: "tool_call", content: "..." })` persiste OK (decisão: expandir `PersistedSessionMessage.role` para os 5 roles).

#### TDD
```
RED:     describe.each([InMemory, FS]) — 7 contract tests parametrizados
RED:     test_fs_path_traversal_rejected()
RED:     test_fs_persists_across_simulated_restart()
RED:     test_fs_deleteConversation_removes_dir()
RED:     test_fs_deleteConversation_rejects_traversal()           # EC-1
RED:     test_fs_listConversationIds_empty_when_dir_missing()     # EC-2
RED:     test_fs_appendMessage_tool_call_role_persists()          # EC-10
GREEN:   FileSystemConversationStorage implementa 5 métodos
REFACTOR: Extrair contract test helper para reuso futuro
VERIFY:  pnpm --filter @theokit/sdk test -- conversation-storage
```

#### Acceptance Criteria
- [ ] 10/10 tests pass (7 contract + 3 FS-specific)
- [ ] Redaction (D68) preservada — test que injeta secret string e valida storage não persiste verbatim
- [ ] Compaction (D18 — every 50 appends, max 200 turns) preservada
- [ ] Zero regressão em `agent-session.test.ts` existente

#### DoD
- [ ] Tests verdes
- [ ] `pnpm --filter @theokit/sdk typecheck` passa
- [ ] Telegram-pro dogfood smoke `/help` continua < 2s (FS path)

### T1.4 — Refactor `agent-session.ts` para consumir adapter

#### Objective
Trocar chamada direta `appendToSessionFile()` por `adapter.appendMessage()` no agent loop, mantendo cache in-process + chained queue.

#### Evidence
Sem essa refactor, T1.5 (`AgentOptions.conversationStorage`) é dead code — não tem caminho que conecta o opt-in do usuário ao append real.

#### Files to edit
```
packages/sdk/src/internal/runtime/agent-session.ts                  (MAJOR REFACTOR)
packages/sdk/src/internal/runtime/local-agent.ts                    (MINOR — passa storage)
packages/sdk/src/internal/runtime/real-local-run.ts                 (MINOR — recebe storage no context)
packages/sdk/tests/persistence/agent-session-with-adapter.test.ts   (NEW)
```

#### Deep file dependency analysis
- `agent-session.ts` hoje chama `appendToSessionFile(cwd, agentId, message)` direto. Refactor: aceitar `storage: ConversationStorageAdapter` opcional; default `new FileSystemConversationStorage({ root: cwd })`.
- `appendSessionMessage(agentId, message, cwd?)` muda para `appendSessionMessage(agentId, message, storage?)`. Backward compat na assinatura externa: se `cwd` ainda for passado, construir `FileSystemConversationStorage({ root: cwd })` on-the-fly (cache by cwd no module level).
- `hydrateSession(agentId, cwd)` → `hydrateSession(agentId, storage)` similar.
- `compactSession(agentId, cwd)` — IMPORTANTE: compactSession É FS-specific (trunca JSONL). Outras storages não precisam. Mover para FS adapter como `private maybeCompact()` interno; expor genericamente como `adapter.compact?()`.

#### Deep Dives
- **EC: cwd → storage migration backcompat.** Callers internos passam `cwd: string` hoje. Adicionar overload: `appendSessionMessage(agentId, message, cwdOrStorage?: string | ConversationStorageAdapter)`. Runtime branch: `typeof cwdOrStorage === "string" ? wrapFS(cwdOrStorage) : cwdOrStorage`.
- **Cache eviction trick:** module-level cache `Map<cwd, FileSystemConversationStorage>` para evitar construir adapter a cada call. Cleared em `clearAllSessions()` (test helper).
- **Compaction:** mover lógica `appendCounts.get(key) % 50 === 0 → compactSessionFile` para método opcional `adapter.compact?(conversationId, maxTurns)`. FS adapter implementa; InMemory ignora.
- **Hydration:** `adapter.getMessages(agentId)` substitui `readSessionFile`. Adapter trata o "file not exists" → return `[]`.

#### Tasks
1. Refactor `appendSessionMessage` para aceitar storage adapter (mantendo cwd backcompat overload).
2. Adicionar module-level cache `Map<cwd, FileSystemConversationStorage>`.
3. Refactor `hydrateSession` similarmente.
4. Adicionar método opcional `compact?` no `ConversationStorageAdapter` interface (T1.1 atualizar).
5. Move compaction trigger pra dentro do FS adapter.
6. Tests: append + read + compact via FS adapter (sanity); append + read via InMemory (verifica que parametric works).

#### TDD
```
RED:     test_append_via_adapter_in_memory()
RED:     test_append_via_adapter_fs_default()
RED:     test_backcompat_cwd_string_still_works()
RED:     test_compaction_only_triggers_for_fs()
RED:     test_hydrate_uses_adapter_not_filesystem()
GREEN:   Refactor agent-session.ts
REFACTOR: Extrair `resolveStorage(cwdOrStorage)` helper
VERIFY:  pnpm --filter @theokit/sdk test -- agent-session
```

#### Acceptance Criteria
- [ ] 5/5 novos tests + ALL existing `agent-session.test.ts` tests passam (backcompat)
- [ ] Zero regressão em integration tests do `local-agent`
- [ ] Telegram-pro dogfood mínimo (`/help` + 1 send) PASS

#### DoD
- [ ] Tests verdes
- [ ] `pnpm --filter @theokit/sdk test` 100% green (full suite)
- [ ] `pnpm --filter @theokit/sdk typecheck` passa

### T1.5 — `AgentOptions.conversationStorage` wiring

#### Objective
Conectar a opção pública `AgentOptions.conversationStorage` ao adapter consumido pelo agent loop.

#### Evidence
Sem isso, o adapter é não-alcançável pelo usuário público. T1.1-T1.4 são plumbing interno.

#### Files to edit
```
packages/sdk/src/internal/runtime/local-agent.ts                  (MODIFY)
  — resolve adapter from options.conversationStorage, fallback to FS
packages/sdk/src/internal/runtime/local-agent-bootstrap.ts        (MODIFY — pass storage)
packages/sdk/src/internal/runtime/real-local-run.ts               (MODIFY — pass storage)
packages/sdk/src/agent.ts                                         (MAYBE — only if needed for registry propagation)
packages/sdk/tests/agent/conversation-storage-option.test.ts      (NEW)
```

#### Deep file dependency analysis
- `LocalAgent` constructor recebe `options.conversationStorage`. Default: `undefined` → fallback FS at first use.
- Quando hidrata na resume, options vem do registry — `conversationStorage` é runtime, não persistido (closure não serializa). Caller deve passar de novo no resume (match com tools handlers pattern, D108).
- `real-local-run.ts` consome `agent.session` para hydrate + append; precisa ver o storage configurado.

#### Deep Dives
- **EC: Custom storage não serializa.** `registry.json` snapshot tem `options: AgentOptions` mas storage é object com métodos. Ao serializar (D17), `conversationStorage` é stripped (vide tools handler pattern). On resume, caller deve passar `conversationStorage` again. Docs.md explicita isso.
- **EC-3 (data-loss safety):** Quando agent foi criado com `conversationStorage` non-undefined, gravar marker `requiresCustomStorage: true` no `RegisteredAgent` persistido. No resume sem `conversationStorage` E marker presente: **throw `ConfigurationError(code: "conversation_storage_required")`** com mensagem clara: `"Agent <id> was created with a custom conversationStorage adapter; pass conversationStorage again on resume to avoid losing history."`. Stronger fail beats silent FS fallback que perde history Postgres. ADR D325 nova.
- **EC: TheoKit's createConversationHistory.** TheoKit wrapper `createConversationHistory(opts)` deve adicionar `conversationStorage` to `AgentOptions` before calling `Agent.getOrCreate`. Cross-repo follow-up.

#### Tasks
1. Adicionar `conversationStorage?: ConversationStorageAdapter` em `AgentOptions` (T1.1 já fez).
2. `LocalAgent` constructor armazena ou resolve lazy.
3. Propagar via `real-local-run` context.
4. Strip do registry serialization (similar a tools handlers).
5. Tests:
   - `Agent.create({ conversationStorage: new InMemoryConversationStorage() })` → send → reload → não persiste no FS.
   - `Agent.create({})` (sem option) → escreve em `.theokit/agents/<id>/messages.jsonl` (backcompat).
   - `Agent.create({ conversationStorage })` → resume sem passar storage → strict mode warning + fallback FS (docs explica).

#### TDD
```
RED:     test_in_memory_adapter_no_fs_writes()
RED:     test_default_writes_to_fs_jsonl()
RED:     test_create_with_custom_storage_persists_marker_in_registry()  # EC-3
RED:     test_resume_without_storage_when_marker_present_throws()       # EC-3
RED:     test_resume_without_storage_no_marker_uses_fs_silently()       # backcompat
RED:     test_custom_adapter_consumed_by_local_run()
GREEN:   Wire option through constructor + marker persistence
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/sdk test -- conversation-storage-option
```

#### Acceptance Criteria
- [ ] `Agent.create({ conversationStorage: new InMemoryConversationStorage() })` zero file writes em `.theokit/agents/`
- [ ] `Agent.create({})` mantém behavior anterior (FS writes)
- [ ] resume sem `conversationStorage` emite stderr warn `[theokit-sdk] conversationStorage not provided on resume; falling back to FS adapter`
- [ ] 4/4 tests pass

#### DoD
- [ ] Tests verdes
- [ ] Telegram-pro dogfood 44/44 PASS
- [ ] `docs.md` section "Conversation Storage" criada

### T1.6 — Postgres + Redis recipes em `docs/recipes/`

#### Objective
Templates pront-to-copy de adapter Postgres + Redis que TheoKit + outros consumers podem adotar.

#### Evidence
Handoff Gap 1 → "Recipes in `theokit-sdk/docs/recipes/`". ADR D305 fixa fora-do-core.

#### Files to edit
```
docs/recipes/conversation-storage-postgres.md      (NEW)
  — full code template + table schema + npm install snippet
docs/recipes/conversation-storage-redis.md         (NEW)
  — full code template + connection setup
docs/recipes/README.md                             (MODIFY or NEW)
  — index of recipes
```

#### Deep file dependency analysis
- Pure docs; nenhum import.
- Validados via copy-paste sanity (T1.6 + um integration test em examples/postgres-bot/ é opcional — DEFER pra TheoKit-side).

#### Deep Dives
- **Postgres recipe:** uses `pg` + `agent_conversations(id text primary key, messages jsonb, updated_at timestamptz default now())`. Append via `INSERT ... ON CONFLICT DO UPDATE messages = messages || $1` (jsonb concat). Read via `SELECT messages`.
- **Redis recipe:** uses `ioredis` + RPUSH/LRANGE para messages list por conversationId. Atomicity via Redis single-threaded model.
- **Edge note:** ambas recipes incluem `@neondatabase/serverless` + `@upstash/redis` HTTP-based variants para CF Workers / Vercel Edge.

#### Tasks
1. Escrever Postgres recipe (~80 linhas markdown + 60 linhas TS).
2. Escrever Redis recipe (~80 linhas markdown + 50 linhas TS).
3. Criar `docs/recipes/README.md` indexando os 2.
4. Update `docs.md` section "Conversation Storage" linkando recipes.

#### TDD
```
RED:     N/A (docs).
GREEN:   Recipes copy-pasteable via cli `npm install pg && cat recipe.ts` → roda.
REFACTOR: None.
VERIFY:  Manual review.
```

#### Acceptance Criteria
- [ ] 2 recipes criadas + README index
- [ ] `docs.md` linka ambas
- [ ] Cross-repo: TheoKit pode copiar diretamente

#### DoD
- [ ] PR review approval do TheoKit team (cross-repo signal)

### T1.7 — Phase 1 Docs + CHANGELOG

#### Objective
Documentar o gap fechado.

#### Files to edit
```
packages/sdk/CHANGELOG.md       (MODIFY — Added under [Unreleased])
docs.md                         (MODIFY — new section "Conversation Storage")
```

#### Tasks
1. CHANGELOG entry:
   ```
   ### Added (`ConversationStorageAdapter` — pluggable conversation persistence)

   - `ConversationStorageAdapter` interface exported from `@theokit/sdk`. Lets consumers in serverless (Vercel, CF Workers) and multi-host (K8s, TheoCloud) provide their own Postgres/Redis/Durable Objects backend instead of the default filesystem JSONL.
   - `InMemoryConversationStorage` exported for tests + ephemeral single-process dev.
   - `FileSystemConversationStorage` exported (default when `AgentOptions.conversationStorage` is unset; preserves the existing `.theokit/agents/<id>/messages.jsonl` behavior byte-identical including redaction D68 + compaction D18).
   - `AgentOptions.conversationStorage?` opt-in; backward compatible.
   - Recipes for Postgres + Redis in `docs/recipes/`.
   ```
2. ADR files: D303, D304, D305, D306 em `.claude/knowledge-base/adrs/`.

#### Acceptance Criteria
- [ ] CHANGELOG entry under `[Unreleased] / Added`
- [ ] docs.md section "Conversation Storage" linked from TOC
- [ ] 4 ADRs filed

#### DoD
- [ ] `pnpm validate` (publint + attw) green
- [ ] Cross-repo bump tag ready: `@theokit/sdk@X.Y.0-next.1`

---

## Phase 2: Gap 2 — `Agent.registry` LRU + idle GC

**Objective:** Eliminar OOM em deploys 24/7 via cache layer com LRU + idle timeout.

### T2.1 — `LiveAgentRegistry` core class

#### Objective
Criar a estrutura de dados central com LRU + tracking.

#### Evidence
Handoff Gap 2 → `Agent.registry` API. ADR D307 separa metadata-registry de live-cache.

#### Files to edit
```
packages/sdk/src/internal/runtime/live-agent-registry.ts         (NEW)
packages/sdk/tests/runtime/live-agent-registry.test.ts           (NEW)
```

#### Deep file dependency analysis
- Standalone module. No imports from `agent-registry.ts` (intentional — separação).
- Consumed by `agent.ts` (Phase T2.5) para `Agent.registry` public surface.

#### Deep Dives
- **Data structure:** `Map<string, { agent: SDKAgent; lastUsedAt: number; insertOrder: number }>`. JavaScript `Map` preserva insertion order — LRU = sort by `lastUsedAt` ascending para evictar.
- **`get(id)` semântica:** read = use; atualiza `lastUsedAt = Date.now()` no get.
- **LRU eviction:** quando `size > maxAgents`, encontrar entry com menor `lastUsedAt`, chamar `await agent.dispose()` (catch+swallow per D309), `map.delete()`.
- **Idle sweep:** `setInterval` (cleared no `evictAll` / process exit). A cada 60s, varre entries com `lastUsedAt < Date.now() - idleTimeoutMs`.
- **Concurrency:** Node single-thread, mas eviction é async (`dispose()` é Promise). Mutex per-id durante eviction para evitar `evict(id)` + `get(id)` race.
- **EC-4 (overwrite leak):** `set(id, newAgent)` quando `id` já tinha entry com `oldAgent !== newAgent` deve `void oldAgent.dispose().catch(() => {})` antes do overwrite. Sem isso, race entre 2 `getOrCreate(id)` concurrent cria 2 agents mas só 1 fica cached — o outro vaza file handles + lifecycle controller. Idempotent quando `oldAgent === newAgent`.

#### Tasks
1. Implementar classe `LiveAgentRegistry`:
   ```ts
   class LiveAgentRegistry {
     #agents = new Map<string, { agent: SDKAgent; lastUsedAt: number }>();
     #maxAgents = 100;
     #idleTimeoutMs = 1_800_000;
     #onEvict?: (id: string, reason: EvictReason) => void;
     #sweepInterval?: NodeJS.Timeout;

     configure(opts: AgentRegistryOptions): void { ... }
     get(id: string): SDKAgent | undefined { ... }
     set(id: string, agent: SDKAgent): void { ... }  // triggers LRU eviction if over
     evict(id: string): Promise<boolean> { ... }
     evictAll(): Promise<void> { ... }
     size(): number { ... }
     ids(): readonly string[] { ... }
     // Internal:
     #evictLRU(): Promise<void> { ... }
     #startSweep(): void { ... }
     #stopSweep(): void { ... }
   }
   ```
2. Singleton export: `export const liveAgentRegistry = new LiveAgentRegistry()`.

#### TDD
```
RED:     test_set_and_get_returns_agent()
RED:     test_get_unknown_returns_undefined()
RED:     test_get_updates_lastUsedAt()
RED:     test_size_reflects_set_count()
RED:     test_ids_returns_in_recency_order_newest_first()
RED:     test_set_with_same_id_different_agent_disposes_old()      # EC-4
RED:     test_set_with_same_id_same_agent_no_dispose()              # EC-4 idempotent
GREEN:   Implementar set/get/size/ids + overwrite-dispose
REFACTOR: Extract lastUsedAt update helper
VERIFY:  pnpm --filter @theokit/sdk test -- live-agent-registry
```

#### Acceptance Criteria
- [ ] 5/5 tests pass
- [ ] Singleton funciona em isolamento (não toca disk, não importa agent-registry.ts)

#### DoD
- [ ] Tests verdes
- [ ] Module < 200 linhas

### T2.2 — LRU eviction policy

#### Objective
Quando `size > maxAgents`, evictar o LRU.

#### Evidence
Handoff test block linha 314-321 (`maxAgents: 3` → 4th set evicts oldest).

#### Files to edit
```
packages/sdk/src/internal/runtime/live-agent-registry.ts    (MODIFY)
packages/sdk/tests/runtime/live-agent-registry.test.ts      (MODIFY)
```

#### Deep Dives
- **LRU = oldest `lastUsedAt`.** Tiebreaker: insertOrder.
- **Eviction async:** `dispose()` é await. `set()` que ultrapassa cap não bloqueia retorno — eviction roda fire-and-forget em background (best-effort). Chamada subsequente `set()` checks size again (caso eviction ainda em-vôo).
- **Hot path optimization:** size check é O(1); LRU finder é O(n). Para n=100, ~10μs. Aceitável.

#### Tasks
1. Implementar `#evictLRU()` privado.
2. Trigger em `set()` quando size > max.
3. Tests:
   - `maxAgents: 3` → 4 sets → 1st evicted.
   - `get(oldest)` antes do 4th set → 4th set evicts second-oldest (LRU updated).

#### TDD
```
RED:     test_lru_evicts_oldest_when_over_max()
RED:     test_get_refreshes_recency_saves_from_eviction()
RED:     test_dispose_called_on_evict()
RED:     test_dispose_error_swallowed_warn_stderr()
GREEN:   Implementar #evictLRU + wire into set
REFACTOR: Extract #findLRU
VERIFY:  pnpm --filter @theokit/sdk test -- live-agent-registry-lru
```

#### Acceptance Criteria
- [ ] LRU eviction observed
- [ ] dispose chamado com error swallowed + stderr warn
- [ ] 4 tests pass

#### DoD
- [ ] Tests verdes

### T2.3 — Idle timeout sweep

#### Objective
Background sweep evicta agents inativos.

#### Evidence
Handoff test linha 333-342 (fake timers + 2000ms advance evicts).

#### Files to edit
```
packages/sdk/src/internal/runtime/live-agent-registry.ts    (MODIFY)
packages/sdk/tests/runtime/live-agent-registry.test.ts      (MODIFY)
```

#### Deep Dives
- **`setInterval(60_000)` armado em `configure()` quando `idleTimeoutMs > 0`.** Cleared em `configure({ idleTimeoutMs: 0 })`.
- **`unref()` no setInterval:** important — caller pode querer exit do processo sem que o sweep mantenha event loop alive.
- **Sweep idempotency:** se sweep dispara durante outro `evict()`, OK (Map.delete on missing = no-op).

#### Tasks
1. Implementar `#startSweep` / `#stopSweep`.
2. `configure()` chama start/stop apropriadamente.
3. Tests com fake timers.

#### TDD
```
RED:     test_idle_evicts_after_timeout()
RED:     test_idle_disabled_when_idleTimeoutMs_zero()
RED:     test_sweep_unref_allows_process_exit()
RED:     test_reconfigure_resets_sweep()
GREEN:   Implementar sweep
REFACTOR: None
VERIFY:  pnpm --filter @theokit/sdk test -- live-agent-registry-idle
```

#### Acceptance Criteria
- [ ] 4 tests pass
- [ ] `unref()` confirmado (`process.exit(0)` em teste de sanity)

#### DoD
- [ ] Tests verdes

### T2.4 — `onEvict` listener + `agent.dispose()` on eviction

#### Objective
Observability hook + cleanup garantido.

#### Evidence
Handoff D309 + linha 344-358 (listener fires + dispose spy).

#### Files to edit
```
packages/sdk/src/internal/runtime/live-agent-registry.ts    (MODIFY)
packages/sdk/tests/runtime/live-agent-registry.test.ts      (MODIFY)
```

#### Tasks
1. Wire `onEvict` callback no `configure()`.
2. Em todo `#evictOne(id, reason)`: chamar `await agent.dispose()` catch+swallow, depois `onEvict(id, reason)` catch+swallow.
3. Test que listener errors swallowed.

#### TDD
```
RED:     test_onEvict_fires_with_reason_lru()
RED:     test_onEvict_fires_with_reason_idle()
RED:     test_onEvict_fires_with_reason_explicit()
RED:     test_onEvict_listener_error_swallowed()
GREEN:   Wire callback
VERIFY:  pnpm --filter @theokit/sdk test -- live-agent-registry-onevict
```

#### Acceptance Criteria
- [ ] 4 tests pass

#### DoD
- [ ] Tests verdes

### T2.5 — Public `Agent.registry` namespace

#### Objective
Expor singleton no `Agent.registry` estático.

#### Evidence
Handoff `Agent.registry: AgentRegistry` API.

#### Files to edit
```
packages/sdk/src/agent.ts                                  (MODIFY — add static registry)
packages/sdk/src/types/agent.ts                            (MODIFY — export AgentRegistryOptions)
packages/sdk/src/index.ts                                  (MODIFY — re-export types)
```

#### Deep Dives
- `Agent.registry` é um `static readonly registry: LiveAgentRegistry` apontando para o singleton.
- `AgentRegistryOptions` type público em `types/agent.ts`.

#### Tasks
1. Adicionar `static readonly registry = liveAgentRegistry` em `class Agent`.
2. Exportar `AgentRegistryOptions` interface.
3. Test smoke: `Agent.registry.configure({ maxAgents: 5 })` funciona.

#### TDD
```
RED:     test_Agent_registry_is_accessible()
RED:     test_Agent_registry_configure_changes_max()
GREEN:   Add static
VERIFY:  pnpm --filter @theokit/sdk test -- agent-registry-public
```

#### Acceptance Criteria
- [ ] `Agent.registry` aparece em autocomplete
- [ ] 2 tests pass

#### DoD
- [ ] Tests verdes

### T2.6 — Wire into `Agent.getOrCreate` cache hit path

#### Objective
`Agent.getOrCreate(id)` consulta o live cache antes de hidratar from disk.

#### Evidence
Sem isso, T2.1-T2.5 são surface, mas o cache nunca tem entries — caller precisa popular manualmente.

#### Files to edit
```
packages/sdk/src/agent.ts                                  (MODIFY — getOrCreate cache lookup)
packages/sdk/tests/agent/getOrCreate-with-cache.test.ts    (NEW)
```

#### Deep Dives
- `Agent.getOrCreate(id, options)`:
  1. `cached = Agent.registry.get(id)` → if found, return cached.
  2. Else resume/create.
  3. After successful resume/create: `Agent.registry.set(id, agent)`.
- **EC: race.** Two getOrCreate(id) concurrent → both miss cache → both create → second hits `agent_id_already_exists` → goes through D22 EC-1 retry path → both end up with same agent. Second one calls `set` overwriting first — but they're the same logical agent. OK.
- **EC: cache disabled.** `Agent.registry.configure({ maxAgents: 0 })` → set is no-op → cache always misses → cada `getOrCreate` re-hydrates. Match com "cache off" mode.

#### Tasks
1. Add cache lookup at start of `getOrCreate`.
2. Add cache populate after successful path.
3. Tests:
   - Same id called twice → second hits cache (no disk read).
   - `Agent.registry.evict(id)` → next `getOrCreate(id)` re-hydrates.

#### TDD
```
RED:     test_getOrCreate_second_call_hits_cache()
RED:     test_evict_forces_rehydrate()
RED:     test_max_zero_disables_cache()
GREEN:   Wire cache
VERIFY:  pnpm --filter @theokit/sdk test -- getOrCreate-with-cache
```

#### Acceptance Criteria
- [ ] 3 tests pass
- [ ] Telegram-pro 44/44 dogfood (caches across messages, no regression)

#### DoD
- [ ] Tests verdes
- [ ] Dogfood smoke pass

### T2.7 — Phase 2 Docs + CHANGELOG

#### Files to edit
```
packages/sdk/CHANGELOG.md       (MODIFY)
docs.md                         (MODIFY — new section "Agent Registry Lifecycle")
.claude/knowledge-base/adrs/D307..D310-*.md  (NEW)
```

#### Tasks
1. CHANGELOG entry detalhando `Agent.registry` API.
2. docs.md section com exemplos:
   - `Agent.registry.configure({ maxAgents: 1000 })`
   - `process.on('SIGTERM', () => Agent.registry.evictAll())`
3. 4 ADRs filed.

#### Acceptance Criteria
- [ ] CHANGELOG `[Unreleased] / Added`
- [ ] docs.md section linked
- [ ] 4 ADRs filed

#### DoD
- [ ] `pnpm validate` green

---

## Phase 3: Gap 3 — `AgentRunError` discriminated

**Objective:** Expandir error codes + adicionar campos para UX/observabilidade decentes.

### T3.1 — Expand `AgentRunErrorCode` union

#### Objective
Adicionar `quota_exceeded`, `tool_runtime_error`, `aborted`.

#### Files to edit
```
packages/sdk/src/errors.ts                                  (MODIFY)
packages/sdk/tests/errors/agent-run-error.test.ts           (MODIFY)
```

#### Deep Dives
- `AgentRunErrorCode = ErrorCode | "quota_exceeded" | "tool_runtime_error" | "aborted"`.
- `AgentRunError.code: AgentRunErrorCode` (type-tighten do `string` atual).
- **EC: backward compat.** Atualizar de `code: string` → `code: AgentRunErrorCode` é technicamente breaking se usuário construiu `new AgentRunError("...", { code: "weird_custom" })`. Mitigação: tipo `AgentRunErrorCode | (string & {})` — TypeScript trick que permite strings literais conhecidos + qualquer outra string (typing without runtime check).

#### Tasks
1. Definir + exportar `AgentRunErrorCode`.
2. Tighten `code` type with `(string & {})` escape hatch.
3. Tests do shape.

#### TDD
```
RED:     test_AgentRunError_code_accepts_quota_exceeded()
RED:     test_AgentRunError_code_accepts_tool_runtime_error()
RED:     test_AgentRunError_code_accepts_aborted()
RED:     test_existing_code_strings_still_accepted()
GREEN:   Add types
VERIFY:  pnpm --filter @theokit/sdk typecheck && test
```

#### Acceptance Criteria
- [ ] 4 tests pass
- [ ] Backward compat: nenhum example quebra typecheck

#### DoD
- [ ] Typecheck green em todos os packages

### T3.2 — Add `retriable`, `retryAfterMs`, `requestId`, `conversationId`

#### Objective
Surface campos que o handoff lista.

#### Files to edit
```
packages/sdk/src/errors.ts                                  (MODIFY)
packages/sdk/tests/errors/agent-run-error-fields.test.ts    (NEW)
```

#### Deep Dives
- `retriable: boolean` — getter computed: `get retriable(): boolean { return this.isRetryable; }`. Alias semântico. Future deprecate `isRetryable` in v2.
- `retryAfterMs?: number` — getter computed: `this.metadata?.retryAfter !== undefined ? this.metadata.retryAfter * 1000 : undefined`. ADR D312.
- `requestId?: string` — novo campo opcional no constructor. Mappers populam from `x-request-id` header (OpenAI/Anthropic).
- `conversationId?: string` — novo campo opcional. Populated by `AgentRunError` wrapper em `Agent.prompt`/etc when error fires inside a known agent context.
- `providerError` — getter aliasing `metadata.raw` (ADR D313).

#### Tasks
1. Adicionar 3 getters computed (retriable, retryAfterMs, providerError).
2. Adicionar 2 fields no constructor (requestId, conversationId).
3. Tests:
   - retriable mirrors isRetryable
   - retryAfterMs converte segundos→ms
   - retryAfterMs undefined quando metadata.retryAfter undefined
   - providerError mirrors metadata.raw
   - requestId stored
   - conversationId stored
   - .message NEVER contains providerError content (anti-leak)

#### TDD
```
RED:     test_retriable_mirrors_isRetryable()
RED:     test_retryAfterMs_converts_seconds_to_ms()
RED:     test_retryAfterMs_undefined_when_no_metadata()
RED:     test_providerError_aliases_metadata_raw()
RED:     test_requestId_stored()
RED:     test_conversationId_stored()
RED:     test_message_never_leaks_providerError()
GREEN:   Add getters + fields
VERIFY:  pnpm --filter @theokit/sdk test -- agent-run-error-fields
```

#### Acceptance Criteria
- [ ] 7 tests pass
- [ ] No breaking change observed via `pnpm publint && attw`

#### DoD
- [ ] Tests verdes

### T3.3 — Provider mapper coverage

#### Objective
Cada provider mapper popula corretamente `code` + `retryAfter` + `requestId`.

#### Evidence
Handoff mapping table linha 458-471.

#### Files to edit
```
packages/sdk/src/internal/errors/mappers/openai-compatible.ts    (MODIFY — add invalid_model + quota_exceeded)
packages/sdk/src/internal/errors/mappers/anthropic.ts             (MODIFY — same)
packages/sdk/src/internal/errors/mappers/shared.ts                (MODIFY — parse requestId)
packages/sdk/tests/errors/mappers/openai.test.ts                  (MODIFY)
packages/sdk/tests/errors/mappers/anthropic.test.ts               (MODIFY)
```

#### Deep Dives
- OpenAI 402 → `quota_exceeded`. Check body para `"code": "insufficient_quota"`.
- OpenAI 400 + "model not found" → `invalid_model` (string match on `error.message`).
- Anthropic 402 → `quota_exceeded` (Anthropic uses 402 only sparingly; check body type).
- `requestId` from `x-request-id` (OpenAI) ou `request-id` (Anthropic, Anthropic-Request-Id).

#### Tasks
1. Adicionar branches `quota_exceeded` + `invalid_model` em ambos os mappers.
2. Parse requestId em `shared.ts`.
3. Tests por provider.

#### TDD
```
RED:     test_openai_402_maps_to_quota_exceeded()
RED:     test_openai_400_model_not_found_maps_to_invalid_model()
RED:     test_anthropic_402_maps_to_quota_exceeded()
RED:     test_anthropic_request_id_parsed()
RED:     test_openai_x_request_id_parsed()
GREEN:   Wire mappers
VERIFY:  pnpm --filter @theokit/sdk test -- errors/mappers
```

#### Acceptance Criteria
- [ ] 5 tests pass
- [ ] Existing mapper tests não regridem

#### DoD
- [ ] Tests verdes

### T3.4 — Tool error → `tool_runtime_error`

#### Objective
Handler throw mapeia para code dedicado.

#### Files to edit
```
packages/sdk/src/internal/tool-dispatch/dispatch.ts                (MODIFY — emit error code)
packages/sdk/src/internal/runtime/local-agent-dispatch.ts          (MODIFY — propagate)
packages/sdk/tests/tool-dispatch/tool-error-code.test.ts           (NEW)
```

#### Deep Dives
- `dispatchToolWithRepair` catch já existe (`internal/tool-dispatch/dispatch.ts:82`). Hoje retorna `DispatchResult { isError: true, content: "Tool execution failed: ..." }`.
- Refactor: além do `DispatchResult.isError`, attach `code: "tool_runtime_error"` ao DispatchResult.
- Quando `Agent.prompt({ throwOnError: true })` → ler `code` do DispatchResult e jogar `AgentRunError({ code: "tool_runtime_error", cause })`.

#### Tasks
1. Add `code?` ao `DispatchResult`.
2. Set `code: "tool_runtime_error"` no catch.
3. Propagate em `local-agent-dispatch.ts`.
4. Wire em `Agent.prompt` quando `throwOnError`.

#### TDD
```
RED:     test_tool_throw_maps_to_tool_runtime_error_code()
RED:     test_throwOnError_jogga_AgentRunError_with_correct_code()
GREEN:   Add code propagation
VERIFY:  pnpm --filter @theokit/sdk test -- tool-error-code
```

#### Acceptance Criteria
- [ ] 2 tests pass

#### DoD
- [ ] Tests verdes

### T3.5 — `aborted` code (depende de Phase 4)

#### Objective
Quando signal dispara, AgentRunError tem `code: "aborted"`.

#### Files to edit
```
packages/sdk/src/internal/runtime/real-local-run.ts                (MODIFY — Phase 4 dependency)
packages/sdk/tests/runtime/aborted-error-code.test.ts              (NEW)
```

#### Tasks
1. Aguardar Phase 4 completar (signal propagation real).
2. No catch do abort, throw `AgentRunError({ code: "aborted", retriable: false })`.

#### TDD
```
RED:     test_abort_signal_throws_AgentRunError_aborted()
GREEN:   Wire after Phase 4
VERIFY:  pnpm test -- aborted-error-code
```

#### Acceptance Criteria
- [ ] 1 test pass

#### DoD
- [ ] Done after Phase 4

### T3.6 — Phase 3 Docs + CHANGELOG

#### Files to edit
```
packages/sdk/CHANGELOG.md                                          (MODIFY)
docs.md                                                            (MODIFY — Error Codes section)
docs/error-codes.md                                                (NEW — standalone reference)
.claude/knowledge-base/adrs/D311..D314-*.md                        (NEW)
```

#### Tasks
1. Mapping table em `docs/error-codes.md`.
2. CHANGELOG `Changed` (existing AgentRunError gains fields, non-breaking) + `Added` (new codes).
3. 4 ADRs filed.

#### Acceptance Criteria
- [ ] docs/error-codes.md created with full mapping
- [ ] CHANGELOG entry
- [ ] 4 ADRs

#### DoD
- [ ] `pnpm validate` green

---

## Phase 4: Gap 5 — `AbortSignal` end-to-end

**Objective:** Propagar `SendOptions.signal` até o `fetch({ signal })` real do provider, cancelando HTTP request mid-stream.

### T4.1 — Plumbing `SendOptions.signal` → LLM client

#### Objective
A infra HTTP existe. Wire it.

#### Files to edit
```
packages/sdk/src/internal/runtime/real-local-run.ts            (MODIFY — accept + propagate signal)
packages/sdk/src/internal/runtime/local-agent.ts               (MODIFY — pass to run)
packages/sdk/src/internal/llm/router.ts                        (MODIFY — signal in request)
packages/sdk/src/internal/llm/types.ts                         (MAYBE MODIFY — signal in StreamChatRequest)
packages/sdk/tests/runtime/send-with-signal.test.ts            (NEW)
```

#### Deep Dives
- `SendOptions.signal?: AbortSignal` existe (`types/run.ts:149`).
- `LocalAgent.send(message, options?)` recebe options. Hoje passa para `pre_user_send` apenas. Refactor: propagate to `realLocalRun` context.
- `realLocalRun(ctx)` chama `streamChat(client, request, signal, ...)` — assinatura JÁ tem `signal: AbortSignal`. Falta `request.signal` ou propagar via parâmetro.
- `router.ts` dispatcher chama os clients OpenAI/Anthropic — eles já aceitam.

#### Tasks
1. Add `signal?: AbortSignal` to internal `RunContext` shape.
2. `LocalAgent.send` writes context.signal from SendOptions.signal.
3. `realLocalRun` passes signal down to `streamChat`.
4. Test: send with aborted signal upfront → fetch never fires.

#### TDD
```
RED:     test_send_with_aborted_signal_never_calls_fetch()
RED:     test_send_signal_aborts_mid_stream_fetch_cancels()
RED:     test_signal_undefined_no_change_to_behavior()
GREEN:   Wire signal
VERIFY:  pnpm --filter @theokit/sdk test -- send-with-signal
```

#### Acceptance Criteria
- [ ] 3 tests pass
- [ ] Verifiable via spy: `fetch` chamado com `{ signal }` carregando user's signal

#### DoD
- [ ] Tests verdes

### T4.2 — `AbortSignal.any` compose user + lifecycle

#### Objective
Combinar user signal + internal agent-dispose signal.

#### Files to edit
```
packages/sdk/src/internal/runtime/abort-utils.ts               (NEW — anySignal ponyfill helper)
packages/sdk/src/internal/runtime/local-agent.ts               (MODIFY — internal #abortController)
packages/sdk/src/internal/runtime/real-local-run.ts            (MODIFY — combine signals)
packages/sdk/tests/runtime/abort-signal-compose.test.ts        (NEW)
packages/sdk/tests/runtime/abort-utils.test.ts                 (NEW)
```

#### Deep Dives
- LocalAgent owns a private `#lifecycleAbortController`. `agent.dispose()` calls `#lifecycleAbortController.abort()`.
- **EC-5 (runtime compat — ADR D324):** `AbortSignal.any` é Node 20+ / CF Workers OK, mas Vercel Edge runtime atual nem sempre tem. Helper `anySignal(signals: AbortSignal[]): AbortSignal` em `abort-utils.ts`:
  ```ts
  export function anySignal(signals: AbortSignal[]): AbortSignal {
    if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
    const ctrl = new AbortController();
    for (const s of signals) {
      if (s.aborted) { ctrl.abort(s.reason); break; }
      s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
    }
    return ctrl.signal;
  }
  ```
- Em `send()`: `const combined = anySignal([userSignal, this.#lifecycleAbortController.signal].filter(Boolean))`.
- Pass `combined` adiante.

#### Tasks
1. Implement `anySignal` ponyfill helper em `internal/runtime/abort-utils.ts`.
2. Tests do helper: native path + ponyfill path (force via stub `AbortSignal.any = undefined`).
3. Add `#lifecycleAbortController` to LocalAgent.
4. `dispose()` aborts it.
5. `send()` composes via `anySignal`.

#### TDD
```
RED:     test_dispose_aborts_in_flight_send()
RED:     test_user_signal_aborts_send_independently()
RED:     test_both_signals_compose_via_anySignal()
RED:     test_anySignal_uses_native_when_available()           # EC-5
RED:     test_anySignal_ponyfill_works_without_native()        # EC-5
RED:     test_anySignal_propagates_reason()                    # EC-5
GREEN:   Wire compose + ponyfill helper
VERIFY:  pnpm --filter @theokit/sdk test -- abort-signal-compose abort-utils
```

#### Acceptance Criteria
- [ ] 3 tests pass

#### DoD
- [ ] Tests verdes

### T4.3 — Partial assistant message não persiste em storage

#### Objective
Quando abort dispara mid-stream, nenhum `appendMessage` foi feito do partial.

#### Evidence
ADR D320 + handoff test linha 749-758.

#### Files to edit
```
packages/sdk/src/internal/runtime/real-local-run.ts            (MODIFY — guard append on abort)
packages/sdk/tests/runtime/abort-no-partial-persist.test.ts    (NEW)
```

#### Deep Dives
- `real-local-run.ts` chama `appendSessionMessage` no `finally` block após receber resposta. Mover para post-stream-complete branch — antes do append, check `signal.aborted`.
- Se signal aborted antes do stream completar, skip append.

#### Tasks
1. Re-arrange storage append em `real-local-run.ts`.
2. Test que persiste user message (sempre) mas não assistant partial.

#### TDD
```
RED:     test_abort_mid_stream_no_assistant_message_persisted()
RED:     test_abort_mid_stream_user_message_still_persisted()
GREEN:   Refactor append placement
VERIFY:  pnpm --filter @theokit/sdk test -- abort-no-partial-persist
```

#### Acceptance Criteria
- [ ] 2 tests pass

#### DoD
- [ ] Tests verdes

### T4.4 — Abort throws `AgentRunError({ code: "aborted" })`

#### Objective
Wrapper em `DOMException` → `AgentRunError`.

#### Files to edit
```
packages/sdk/src/internal/runtime/real-local-run.ts            (MODIFY — wrap abort)
packages/sdk/tests/runtime/abort-error-class.test.ts           (NEW)
```

#### Tasks
1. Catch `DOMException("...", "AbortError")` no run loop.
2. Re-throw como `AgentRunError({ code: "aborted", retriable: false, cause: original })`.
3. Tests.

#### TDD
```
RED:     test_abort_throws_AgentRunError_instance()
RED:     test_abort_error_code_is_aborted()
RED:     test_abort_error_retriable_false()
RED:     test_abort_error_cause_is_DOMException()
GREEN:   Wrap
VERIFY:  pnpm --filter @theokit/sdk test -- abort-error-class
```

#### Acceptance Criteria
- [ ] 4 tests pass

#### DoD
- [ ] Tests verdes

### T4.5 — Phase 4 Docs + CHANGELOG

#### Files to edit
```
packages/sdk/CHANGELOG.md                                          (MODIFY)
docs.md                                                            (MODIFY — Cancellation section)
.claude/knowledge-base/adrs/D318..D321-*.md                        (NEW)
```

#### Tasks
1. CHANGELOG entry.
2. docs.md section "Cancellation".
3. 4 ADRs.

#### Acceptance Criteria
- [ ] CHANGELOG entry
- [ ] docs section
- [ ] 4 ADRs

#### DoD
- [ ] `pnpm validate` green

---

## Phase 5: Gap 4 — Tool lifecycle hooks

**Objective:** `AgentOptions.onToolStart`/`End`/`Error` callbacks.

### T5.1 — Types em `AgentOptions`

#### Files to edit
```
packages/sdk/src/types/agent.ts                                (MODIFY — add 3 callbacks)
```

#### Tasks
1. Add `onToolStart?`, `onToolEnd?`, `onToolError?` em `AgentOptions`.
2. Define event payload types: `ToolStartEvent`, `ToolEndEvent`, `ToolErrorEvent`.

#### TDD
```
RED:     test_options_accept_tool_hooks()
GREEN:   Add types
VERIFY:  pnpm typecheck
```

#### Acceptance Criteria
- [ ] Types compile
- [ ] Autocomplete shows hooks

#### DoD
- [ ] Typecheck green

### T5.2 — `callId` propagation

#### Files to edit
```
packages/sdk/src/internal/tool-dispatch/dispatch.ts             (MODIFY — already has callId)
packages/sdk/src/internal/runtime/local-agent-dispatch.ts       (MODIFY — pass callId to hooks)
```

#### Deep Dives
- `DispatchResult.callId` JÁ existe. Refactor leve.
- `local-agent-dispatch.ts` chama `dispatchToolWithRepair`, recebe `{ callId, isError, content }`. Plumb to hook emission.

#### Tasks
1. Ensure `callId` in scope of hook emission point.

#### TDD
N/A (refactor).

#### Acceptance Criteria
- [ ] Test em T5.3 verifies callId identity start↔end.

### T5.3 — Wrap dispatch + emit events

#### Files to edit
```
packages/sdk/src/internal/runtime/local-agent-dispatch.ts       (MAJOR MODIFY)
packages/sdk/tests/runtime/tool-hooks.test.ts                   (NEW)
```

#### Deep Dives
- Wrap `dispatchToolWithRepair(call, registry)`:
  ```ts
  const startAt = Date.now();
  try {
    onToolStart?.({ toolName, args, conversationId, callId });
  } catch (e) { stderr.warn(...) }

  const result = await dispatchToolWithRepair(call, registry);

  if (result.isError) {
    try {
      onToolError?.({ toolName, args, error: new Error(result.content), conversationId, callId, durationMs: Date.now() - startAt, attempt: 1 });
    } catch (e) { stderr.warn(...) }
  } else {
    try {
      onToolEnd?.({ toolName, args, result: result.content, conversationId, callId, durationMs: Date.now() - startAt });
    } catch (e) { stderr.warn(...) }
  }

  return result;
  ```

#### Tasks
1. Implement wrapper.
2. Tests: start fires before handler, end after, error fires on isError, hook errors swallowed, durationMs measured.

#### TDD
```
RED:     test_onToolStart_fires_before_handler()
RED:     test_onToolEnd_fires_with_result_and_durationMs()
RED:     test_onToolError_fires_on_handler_throw()
RED:     test_callId_identical_in_start_end_pair()
RED:     test_hook_errors_dont_abort_run()
RED:     test_onToolError_receives_Error_instance_not_string()  # EC-6
RED:     test_onToolError_fires_on_validate_fail_with_Error()   # EC-6
GREEN:   Implement wrapper; always wrap content into `new Error(content)` for onToolError payload
VERIFY:  pnpm --filter @theokit/sdk test -- tool-hooks
```

#### Acceptance Criteria
- [ ] 5 tests pass
- [ ] Telegram-pro 44/44

#### DoD
- [ ] Tests verdes

### T5.4 — Phase 5 Docs + CHANGELOG

#### Files to edit
```
packages/sdk/CHANGELOG.md                                          (MODIFY)
docs.md                                                            (MODIFY — Tool Hooks section)
.claude/knowledge-base/adrs/D315..D317-*.md                        (NEW)
```

#### Acceptance Criteria
- [ ] CHANGELOG entry
- [ ] docs section
- [ ] 3 ADRs

#### DoD
- [ ] `pnpm validate` green

---

## Phase 6: Gap 6 — Quota/abuse hooks

**Objective:** `AgentOptions.onBeforeCreate`/`onBeforeSend` (errors propagate).

### T6.1 — Types em `AgentOptions`

#### Files to edit
```
packages/sdk/src/types/agent.ts                                (MODIFY)
```

#### Tasks
1. Add `onBeforeCreate?` + `onBeforeSend?`.
2. Define event payloads: `BeforeCreateEvent { conversationId; userId? }`, `BeforeSendEvent { conversationId; messageCount }`.

#### Acceptance Criteria
- [ ] Types compile

#### DoD
- [ ] Typecheck green

### T6.2 — Wire `onBeforeCreate` em `Agent.create`/`getOrCreate`

#### Files to edit
```
packages/sdk/src/agent.ts                                      (MODIFY — call hook before side effects)
packages/sdk/tests/agent/onBeforeCreate.test.ts                (NEW)
```

#### Deep Dives
- `Agent.create(opts)`:
  1. `validateAgentOptions(opts)` ✓ existing
  2. `await opts.onBeforeCreate?.({ conversationId: opts.agentId ?? "auto", userId: opts.metadata?.userId })` — NEW
  3. Hook throws → propagate (NOT caught)
  4. Continue with create
- `Agent.getOrCreate(id, opts)`: cache hit path skips hook (already created); cache miss runs `Agent.create` which runs hook.

#### Tasks
1. Add hook call.
2. Test: hook throws → create rejects with same error.
3. Test: hook resolves → create proceeds.
4. Test: cache hit doesn't re-fire hook.

#### TDD
```
RED:     test_onBeforeCreate_throws_blocks_create()
RED:     test_onBeforeCreate_resolves_create_proceeds()
RED:     test_onBeforeCreate_skipped_on_cache_hit()
GREEN:   Wire
VERIFY:  pnpm --filter @theokit/sdk test -- onBeforeCreate
```

#### Acceptance Criteria
- [ ] 3 tests pass

#### DoD
- [ ] Tests verdes

### T6.3 — Wire `onBeforeSend` em `agent.send()`

#### Files to edit
```
packages/sdk/src/internal/runtime/local-agent.ts               (MODIFY — call hook in send)
packages/sdk/tests/agent/onBeforeSend.test.ts                  (NEW)
```

#### Deep Dives
- `agent.send(message, options)`:
  1. `messageCount = currentSessionMessages.length`
  2. `await opts.onBeforeSend?.({ conversationId: this.agentId, messageCount })` — NEW
  3. Hook throws → propagate
  4. Continue with send
- Ordered: hook ANTES de storage append, ANTES de provider call.

#### Tasks
1. Add hook call em `send`.
2. Tests:
   - Hook throws → send rejects.
   - Hook resolves → send proceeds.
   - No storage write happened when hook rejected.

#### TDD
```
RED:     test_onBeforeSend_throws_blocks_send()
RED:     test_onBeforeSend_resolves_send_proceeds()
RED:     test_onBeforeSend_rejection_no_side_effects()
GREEN:   Wire
VERIFY:  pnpm --filter @theokit/sdk test -- onBeforeSend
```

#### Acceptance Criteria
- [ ] 3 tests pass

#### DoD
- [ ] Tests verdes

### T6.4 — Phase 6 Docs + CHANGELOG

#### Files to edit
```
packages/sdk/CHANGELOG.md                                          (MODIFY)
docs.md                                                            (MODIFY — Quota Hooks section)
.claude/knowledge-base/adrs/D322..D323-*.md                        (NEW)
```

#### Tasks
1. CHANGELOG entry with "100 conversations per user" example.
2. docs section.
3. 2 ADRs.

#### Acceptance Criteria
- [ ] CHANGELOG entry
- [ ] docs section with example
- [ ] 2 ADRs

#### DoD
- [ ] `pnpm validate` green

---

## Phase 7: Dogfood QA (MANDATORY)

> Plano NÃO é DONE até esta phase passar.

**Objective:** Validar que os 6 gaps fechados funcionam end-to-end como um usuário real experimentaria, não só como unit tests passam.

### T7.1 — Telegram-pro regression sweep

#### Objective
`examples/telegram-pro` dogfood completo, comparando antes/depois.

#### Evidence
Memory `feedback-dogfood-after-plan` — skill `/dogfood` é gate canônico.

#### Tasks
1. Run `/dogfood full`.
2. Compare to baseline 44/44 PASS (pre-plan).
3. Zero CRITICAL introduced. Zero HIGH em comandos modificados.

#### Acceptance Criteria
- [ ] Telegram-pro dogfood ≥ 44/44 PASS (não regrediu)
- [ ] Health score ≥ 70
- [ ] Zero CRITICAL/HIGH novos

#### DoD
- [ ] `/dogfood full` PASS

### T7.2 — Cross-repo smoke contra TheoKit

#### Objective
Bumped pre-release validada em `examples/openrouter-demo` da TheoKit.

#### Tasks
1. Publish `@theokit/sdk@X.Y.0-next.N` (tag, não main).
2. TheoKit-side: bump dep + write fixture:
   - Use `conversationStorage: new RedisConversationStorage()` from recipe.
   - Pass `signal` from `request.signal` to `agent.send`.
   - Wire `onToolStart/End/Error` para `trackAgentRun`.
   - Use `error.code` para branchar UI retry CTA.
3. Run TheoKit `pnpm test:integration` + smoke `/chat` end-to-end.

#### Acceptance Criteria
- [ ] TheoKit openrouter-demo `npm test` PASS com nova SDK
- [ ] Cancel mid-stream em browser → no token leak (verify via OpenRouter dashboard usage)
- [ ] Quota hook bloqueia 101st conversation per user

#### DoD
- [ ] Cross-repo smoke green

### T7.3 — Real-LLM examples coverage

#### Objective
Cada gap que toca `agent.send()` rodou contra LLM real.

#### Evidence
Regra `.claude/rules/real-llm-validation.md`.

#### Tasks
1. `examples/conversation-storage-postgres/` (NEW) — send/wait/dispose com Postgres real.
2. `examples/abort-mid-stream/` (NEW) — start send, abort após 200ms, verify no token charged.
3. `examples/tool-hooks-tracking/` (NEW) — send with tools, log start/end/error events.
4. Cada example com `OPENROUTER_API_KEY` real.

#### Acceptance Criteria
- [ ] 3 novos examples validated with real LLM
- [ ] Cada um documentado em `examples/<name>/README.md`

#### DoD
- [ ] All 3 examples PASS

### T7.4 — Cross-validation /xval

#### Objective
Cross-validate plan vs implementation.

#### Tasks
1. Run `/cross-validation production-readiness`.

#### Acceptance Criteria
- [ ] APROVADO ou APROVADO COM RESSALVAS (CRITICALs fixados)

#### DoD
- [ ] Report em `.claude/knowledge-base/reviews/cross-validation/production-readiness-xval-YYYY-MM-DD.md`

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | ConversationStorageAdapter interface + FS default + InMemory + Postgres/Redis recipes | T1.1-T1.7 | Interface pública, 2 adapters in-core, 2 recipes |
| 2 | Agent.registry LRU + idle GC + dispose-on-evict | T2.1-T2.7 | LiveAgentRegistry singleton, 100/30min defaults |
| 3 | AgentRunError code discriminated + retriable + retryAfterMs + requestId + conversationId + mapping table | T3.1-T3.6 | 3 new codes, 4 new fields (getters), per-provider mappers, docs/error-codes.md |
| 4 | onToolStart/End/Error em AgentOptions com callId + durationMs | T5.1-T5.4 | 3 callbacks, errors swallowed, callId reused from DispatchResult |
| 5 | signal?: AbortSignal em send() propaga até fetch HTTP | T4.1-T4.5 | Plumbing existing infra, AbortSignal.any compose, no partial persist, AgentRunError aborted |
| 6 | onBeforeCreate / onBeforeSend hooks com errors propagados | T6.1-T6.4 | 2 gates pré-side-effects, propagate rejection |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All 7 phases completed
- [ ] All tests passing (SDK + recipes typecheck)
- [ ] Zero typecheck / lint warnings (`pnpm validate`)
- [ ] Backward compatibility preserved (existing examples unmodified continue to pass)
- [ ] 23 new ADRs filed (D303-D323 base) + 2 absorbidos do edge-case review (D324 — anySignal ponyfill; D325 — `requiresCustomStorage` marker) = 25 total
- [ ] CHANGELOG `[Unreleased]` populated per phase
- [ ] docs.md sections: Conversation Storage, Agent Registry Lifecycle, Error Codes, Cancellation, Tool Hooks, Quota Hooks
- [ ] `docs/error-codes.md` + `docs/recipes/conversation-storage-{postgres,redis}.md` written
- [ ] **Dogfood QA PASS** — `/dogfood full` ≥ 44/44, health ≥ 70, zero CRITICAL/HIGH novos
- [ ] **Runtime-metric proof** — para tasks que referenciam runtime counter:
  - T2.3 idle sweep: observe eviction count > 0 in dogfood scenario after fake-timer advance
  - T4.3 abort guard: verify partial-persist counter == 0 across 100 mid-stream aborts
  - T5.3 hook fires: verify onToolEnd count == onToolStart count in dogfood telegram-pro tool-heavy command
- [ ] Cross-repo smoke (T7.2) — TheoKit openrouter-demo validation green
- [ ] 3 new real-LLM examples (T7.3) PASS

## Final Phase: Dogfood QA (MANDATORY)

> This phase runs AFTER all implementation phases are complete. The plan is NOT done until dogfood passes.

**Objective:** Validate that the implemented changes work as a real user would experience them, not just as unit tests assert.

### Execution

Run `/dogfood full`. Always full. No shortcuts.

### Acceptance Criteria

- [ ] Health score ≥ 70/100
- [ ] Zero CRITICAL issues introduced by this plan's changes
- [ ] Zero HIGH issues in commands/features modified by this plan
- [ ] Any pre-existing issues documented (not caused by this plan)
- [ ] Baseline diff: post-plan ≥ pre-plan (44/44) PASS count

### If Dogfood Fails

1. Identify which issues are caused by this plan's changes vs pre-existing
2. Fix all plan-caused CRITICAL and HIGH issues before declaring the plan complete
3. Re-run `/dogfood full` to confirm fixes
4. Pre-existing issues are logged but do NOT block plan completion

---

## Notas finais

**Versionamento por phase (recomendado):**

| SDK version | Includes |
|-------------|----------|
| `^X.Y.0-next.1` | Phase 1 (ConversationStorageAdapter) |
| `^X.Y.0-next.2` | Phase 2 (Agent.registry) |
| `^X.Y.0-next.3` | Phase 3 (AgentRunError codes) |
| `^X.Y.0-next.4` | Phase 4 (AbortSignal) |
| `^X.Y.0-next.5` | Phase 5 (Tool hooks) |
| `^X.Y.0-next.6` | Phase 6 (Quota hooks) |
| `^X.Y+1.0`     | Final consolidated minor (after Phase 7) |

TheoKit pode consumir incrementalmente — cada one unblocks one deploy category.

**Out-of-scope explícito deste plano:**

- TheoKit-side fixes (CSP nonce, Redis rate-limit, Postgres outbox, theo-cloud deploy) — `theokit/docs/plans/`
- Provider-specific bug fixes (OpenAI quirks, Anthropic streaming edge cases) — separate work
- UI-side issues (`@theokit/ui`) — separate repo
- Theo PaaS endpoints — cloud runtime is pre-release per CLAUDE.md root

**Riscos & mitigações:**

| Risco | Mitigação |
|---|---|
| Refactor de `agent-session.ts` quebra telegram-pro silently | Phase 1 valida com /dogfood entre cada T |
| LRU eviction race com in-flight `send()` | T2.2 incluiu test concurrent set/get |
| `AbortSignal.any` não disponível em runtime alvo | D1 já fixa Node 22+ minimum; CF Workers/Vercel Edge têm |
| Mapper expansion quebra existing tests | T3.3 mantém all existing test green; add-only mode |
| Tool hooks adicionam overhead a cada call | T5.3 inclui benchmark: <100μs adicionados/call (typically 50μs) |
| Quota hook async lento bloqueia hot path | Docs.md explicita: hook deve ser fast (e.g. cached count); slow hook = slow agent |
| Postgres recipe code-rot fora do CI | Recipe linkado mas optional integration test em `examples/postgres-bot/` (DEFER se necessário) |

**Critério de cancel da phase corrente (rollback):**

Cada phase é commit isolado. Se /dogfood post-phase falha com regressão not-fixable em 1 dia: `git revert` da phase commit e voltar à última passing. Plan resume da próxima phase. Nenhuma phase é "all-or-nothing" — bumps são independentes.

---

## Edge-case review absorbed (2026-05-25)

Review completo em `.claude/knowledge-base/reviews/edge-case/production-readiness-edges-2026-05-25.md`. **6 MUST FIX absorvidos** + 6 SHOULD TEST integrados + 5 DOCUMENT registrados para docs.md:

| EC | Family | Absorbed into |
|----|--------|--------------|
| EC-1 | Path traversal | T1.3 Deep Dives + test `test_fs_deleteConversation_rejects_traversal` |
| EC-2 | I/O ENOENT | T1.3 Deep Dives + test `test_fs_listConversationIds_empty_when_dir_missing` |
| EC-3 | State / data loss | T1.5 Deep Dives + ADR D325 (`requiresCustomStorage` marker) + tests |
| EC-4 | Resource leak | T2.1 Deep Dives + tests `test_set_with_same_id_different_agent_disposes_old` |
| EC-5 | Runtime compat | T4.2 NEW file `abort-utils.ts` + ADR D324 (anySignal ponyfill) + 3 tests |
| EC-6 | Pair invariant | T5.3 tests `test_onToolError_receives_Error_instance` + validate-fail branch |
| EC-7 (SHOULD TEST) | Race | T2.2 — adicionar test `test_get_during_eviction_returns_undefined_or_disposing` |
| EC-8 (SHOULD TEST) | Race | T2.3 — sweep re-check entry identity após await dispose |
| EC-9 (SHOULD TEST) | Lifecycle | T4.4 — test tool handler continues after abort, result discarded |
| EC-10 (SHOULD TEST) | Format | T1.3 absorbed (expand PersistedSessionMessage.role to 5 roles) |
| EC-11 (SHOULD TEST) | Boundary | T3.2 — test `retryAfterMs === 0` (not undefined) |
| EC-12 (SHOULD TEST) | Naming | T6.3 — rename payload field to `previousMessageCount` for clarity |
| EC-13 (DOCUMENT) | UX | docs.md "Cancellation" section: eviction-abort vs user-abort distinction |
| EC-14 (DOCUMENT) | Cross-repo | T7.2 — 1-week SLA + publish-anyway fallback |
| EC-15 (DOCUMENT) | Fragility | docs/error-codes.md: provider copy changes → unknown fallback is safe |
| EC-16 (DOCUMENT) | Precision | docs.md Tool Hooks: durationMs may be 0; use Math.max for rates |
| EC-17 (DOCUMENT) | Future | docs.md Tool Hooks: `attempt` always 1 in v1, reserved for v2 retry |
