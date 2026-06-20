# Auditoria de Gaps do Ecossistema Theo

> Relatório final — auditoria de lacunas que impedem que "qualquer um construa um agente / code-assistant" sobre o ecossistema Theo (theokit + theokit-sdk + theo-ui + di + gateways) sem reinventar a roda.
>
> Método: mapeamos tudo que o `theocode` (code-assistant de referência construído sobre o stack) implementou À MÃO e cruzamos contra o que o ecossistema já oferece. Cada gap foi verificado adversarialmente (tentativa explícita de refutação contra o código-fonte) e classificado por `boundary` (de quem é a responsabilidade), `classification` e `severity`.
>
> Total de candidatos analisados: 66 — **confirmados: 52**.

---

## 1. Sumário executivo

### Veredito

O ecossistema Theo **já permite construir um agente/code-assistant — mas ainda NÃO sem reinventar uma quantidade significativa de plumbing genérico.** O `theocode` prova que o stack é capaz: ele roda um code-assistant completo (agent loop, tools, memória, plan-mode, eval/SWE-bench, UI). Porém, para chegar lá, o `theocode` precisou escrever à mão dezenas de primitivos que **NÃO são específicos de domínio de code-assistant** — são plumbing que qualquer consumidor sério do harness reescreveria de forma idêntica.

O padrão dominante é revelador: das 52 lacunas confirmadas, **34 são `hybrid`** (o mecanismo genérico deveria ser do framework, mas a política/conteúdo é legítimo do app) e **14 são puramente `framework`**. Apenas **4 são `app`** (theocode acertou o boundary). Ou seja: a esmagadora maioria dos gaps é "o framework tem metade do primitivo, ou o tem internamente (`@internal`), ou tem a forma declarativa (decorator) sem runtime". O ecossistema não está faltando capacidade — está faltando **expor, ligar (wire) e documentar** capacidades que muitas vezes já existem 90% prontas.

Três anti-padrões recorrentes explicam quase todos os gaps:

1. **Decorator sem runtime** — `@ContextWindow`, `@ProjectContext`, `@Skills`, `AutoSummarize` declaram config mas compilam para nada executável (`getContextWindowConfig`/`getProjectContextConfig` não têm consumidor).
2. **Primitivo `@internal` selado** — a lógica existe e é testada dentro do SDK (compaction, `resolveModelCapabilities`, `createSemaphore`, `parseSkillFrontmatter`, `session-summary-writer`, `atomicWriteText`) mas não está no barrel público.
3. **Promessa quebrada no loop** — `nextIteration()` do `BudgetTracker` nunca é chamado; o evento `stop` do hook existe no type union mas nunca dispara; o código `context_too_long` existe mas não chega ao boundary do stream.

### Os 5 gaps mais importantes (severidade HIGH + maior alavancagem)

1. **`budgetTracker.nextIteration()` morto no loop (`@theokit/sdk`)** — O teto de iterações que os trackers públicos anunciam é dead code: o loop nunca chama `nextIteration()`. Resultado: `createCounterBudgetTracker({ maxIterations })` não tem efeito, forçando o theocode a um `stepCapTracker` à mão (`agent-stream.ts:95-110`). Um guard-rail universal ("não deixe o loop fugir e queimar dinheiro") está quebrado.

2. **Loop de continuação sobre o teto interno de 8 passos (`@theokit/sdk`)** — `agent.send` corta no `maxIterations ?? 8` SEM knob público para elevar. Qualquer agente long-running perde trabalho silenciosamente ao exceder 8 tool calls. O theocode reconstruiu detector de truncamento + re-send de histórico + step budget + terminais (`agent-loop.ts:8-14`).

3. **Compaction de conversa não exposta (`@theokit/sdk`)** — O algoritmo (split/summarize/checkpoint/overflow-detect) existe `@internal` no SDK, mas o consumidor imperativo teve que copiar de OpenCode wholesale (`compaction.ts:1-13`). É o modo de falha #1 em produção de agentes de chat.

4. **SSRF guard + screen de shell catastrófico ausentes (`@theokit/sdk-tools`)** — `createWebFetchTool` alcança `127.0.0.1`/RFC1918/`169.254.169.254` e segue redirects; `createShellTool` roda `/bin/sh -c` com zero screening. O theocode hand-buildou ambos os guards (`web-fetch-guard.ts`, `shell-guard.ts`). Duas reinvenções independentes já existem no monorepo (telegram-pro também hand-rolla). É a barreira entre demo e deploy.

5. **`isTransientError` / classificador de erro retryável não público (`@theokit/sdk`)** — O SDK SABE classificar transitoriedade (`RateLimitError`, `NetworkError`, `defaultRetriableForCode`) mas não expõe o predicado. O theocode reinventou via regex frágil sobre `err.message` (`retry.ts:48`), arriscando divergir da própria taxonomia do framework. Classificar errado queima budget ou falha runs.

**Bônus de alavancagem (HIGH):** repo-map/`buildRepoMap` (orientar o LLM no codebase), discovery de skills em diretório arbitrário, `AgentToolRenderer`/adapters tool→componente UI, runner batch resiliente (resume + flush incremental) para evals multi-hora, e a migração drizzle-kit que nasceu de um incidente de produção.

---

## 2. Tabela mestra de gaps confirmados

Ordenada por severidade (high → medium → low) e depois por boundary (framework → hybrid → app).

| Gap | Domínio | Classificação | Boundary | Package-alvo | Sev. | Evidência (theocode) | Oportunidade |
|---|---|---|---|---|---|---|---|
| `budgetTracker.nextIteration()` morto — teto de iterações não enforced | agent-runtime | missing-primitive | framework | @theokit/sdk | high | agent-stream.ts:81-110 | Step cap fail-closed em 1 linha p/ todo builder |
| Tool scoping por sub-agente sem enforcement — só prompt soft | project-config | missing-primitive | framework | @theokit/sdk | medium | config-loader.ts:130-146 | Sub-agente read-only PROVADAMENTE sem Write/Bash |
| `safeFilenameForId` — id→filename seguro (4 respostas divergentes) | memory-plan-skills | dx-friction | framework | @theokit/sdk path-safety | low | plan-store.ts:21-24 | Filename seguro p/ qualquer id opaco em 1 call |
| Token estimate + shouldCompact (decisão pré-call) | agent-runtime | missing-primitive | framework | @theokit/sdk | low | token-estimate.ts:1-37 | Compaction proativa; dá runtime ao @ContextWindow |
| `default-deny` mode no PermissionEngine | sdk-integration | legit-app-concern | framework | @theokit/sdk PermissionEngine | low | permission.plugin.ts:136-188 | Modo read-only fail-closed declarativo |
| Health-check route p/ filesystem-route server | http-layer | doc-gap | framework | theokit (packages/theo) | low | routes/health.ts:3-9 | Probes K8s grátis no `theokit dev` |
| Boot programático do filesystem-route server | http-layer | legit-app-concern | framework | theokit (packages/theo) | low | server/index.ts:1-2 | Embed/test in-process do server real |
| 404 typed exception em defineRoute | http-layer | dx-friction | framework | theokit (packages/theo) | medium | session/[id]/index.ts:12-14 | Envelope de erro canônico cross-surface |
| `AgentToolRenderer` (despacho tool→componente rico) | ui-surface | missing-primitive | framework | @theokit/ui | high | activity-panel.tsx:30 | Render rico de tool stream em 1 linha |
| Auto-scroll stick-to-bottom (`useStickToBottom`) | ui-surface | missing-primitive | framework | @theokit/ui | high | chat-pane.tsx:197 | Follow-output robusto a conteúdo de altura tardia |
| `accumulateAssistantText` + `streamError` | ui-surface | missing-primitive | framework | theokit/client | medium | chat-helpers.ts:4 | `liveText`/`error` derivados no hook |
| Fold de AgentEvent → tool cards | ui-surface | missing-primitive | framework | theokit/client | high | chat-helpers.ts:166 | `useAgentToolCards` correlaciona call→result |
| `mapWithConcurrency` (pool ordenado bounded) | app-utils | missing-primitive | framework | @theokit/sdk concurrency | medium | lib/concurrency.ts:16 | p-map-equivalent; dedupe 5 cópias internas |
| `withRetry` genérico (clock injetável) | app-utils | missing-primitive | framework | @theokit/sdk | medium | lib/retry.ts:24 | Retry+backoff testável p/ qualquer thunk |
| `isTransientError` — classificador de erro retryável | app-utils | missing-primitive | framework | @theokit/sdk errors.ts | high | lib/retry.ts:48 | Fonte única da taxonomia de transitoriedade |
| Loop de continuação sobre teto interno de 8 passos | agent-runtime | missing-primitive | hybrid | @theokit/sdk | high | agent-loop.ts:8-14 | Turnos multi-round confiáveis out-of-the-box |
| Compaction (summarize→checkpoint→keep-recent) | agent-runtime | missing-primitive | hybrid | @theokit/sdk | high | compaction.ts:1-13 | Import em vez de copiar de OpenCode |
| Reflection ladder corretiva bounded | agent-runtime | missing-primitive | hybrid | @theokit/sdk | medium | agent-loop.ts:234-248 | Hook `stop`/onWouldTerminate + tool-result tipado |
| Erro tipado de context-overflow no boundary | agent-runtime | dx-friction | hybrid | @theokit/sdk | medium | compaction.ts:103-114 | `event.code === "context_too_long"` vs regex |
| Continuation-history (event→replayable bounded) | agent-runtime | missing-primitive | hybrid | @theokit/sdk | medium | continuation-history.ts:4-13 | `buildReplayHistory` p/ loop stateless |
| Agregação de usage multi-round (honest-null) | agent-runtime | missing-primitive | hybrid | @theokit/sdk-budget | low | agent-loop.ts:192-205 | Custo honesto: unknown envenena a soma, não vira $0 |
| Headless code-runner (git diff + patch validate) | agent-runtime | missing-primitive | hybrid | @theokit/sdk + sdk-tools | medium | headless-runner.ts:5-11 | Eval de patch como artefato gradeável |
| Discovery de skills em dir arbitrário + `<skills>` | memory-plan-skills | missing-primitive | hybrid | @theokit/sdk | high | skills-store.ts:5-9,40-43 | `discoverSkills(dir)` p/ qualquer convenção |
| Memory taxonomia tipada (markdown + frontmatter) | memory-plan-skills | missing-primitive | hybrid | @theokit/sdk-memory | medium | memory-store.ts:21-89 | `createCategorizedMemory({categories})` |
| Plan-mode artifact persistence | memory-plan-skills | missing-primitive | hybrid | @theokit/sdk-tools + sdk | medium | plan-store.ts:17-43 | Plano durável/recuperável vs toggle in-memory |
| SSRF guard p/ web_fetch | tools-guards | missing-primitive | hybrid | @theokit/sdk-tools | high | web-fetch-guard.ts:32-94 | web_fetch safe-by-default contra SSRF |
| Screen de shell catastrófico | tools-guards | missing-primitive | hybrid | @theokit/sdk-tools | high | shell-guard.ts:87-143 | Backstop contra rm -rf/curl\|sh/force-push |
| Rich errors (self-correction em tool fail) | tools-guards | missing-primitive | hybrid | @theokit/sdk-tools | medium | rich-errors.ts:27-82 | Recuperação de modelo fraco out-of-the-box |
| ACI description override + `<tools>` render | tools-guards | dx-friction | hybrid | @theokit/sdk-tools | medium | tool-descriptions.ts:134-164 | Override + render de single source, sem drift |
| Per-mode tool permission + usage/cost projection | tools-guards | legit-app-concern | hybrid | @theokit/server/cost + sdk | low | tool-catalog.ts:42-78 | Sentinel cost-known no framework |
| Repo-map / env-context builder | project-config | missing-primitive | hybrid | @theokit/sdk-tools | high | project-context.ts:34-176 | Orientar o LLM no codebase em 1 call |
| Reader/writer hierárquico de project-instructions | project-config | missing-primitive | hybrid | @theokit/sdk | medium | project-context.ts:190-217; theocode-doc.ts:12-30 | `readProjectInstructions` git-root-walk + write |
| Catastrophic shell screen (perm.plugin path) | sdk-integration | legit-app-concern | hybrid | @theokit/agents | low | permission.plugin.ts:107-122 | Denylist curada opt-in composável |
| Stream-message → wire-event mapper imperativo | sdk-integration | missing-primitive | hybrid | @theokit/sdk | medium | sdk-mappers.ts:17-99 | Readers sobre SDKMessage (text/usage/cost) |
| Catálogo per-model context-window à mão | sdk-integration | dx-friction | hybrid | @theokit/sdk | medium | code.prompt.ts:60-79 | Lookup sync/offline por slug arbitrário |
| Drizzle Repository CRUD reescrito | persistence | dx-friction | hybrid | @theokit/orm | medium | session.repo.ts:12 | `createRepository(db, table)` + sync-aware |
| SQLite bootstrap (WAL+FK, sem corruption) | persistence | dx-friction | hybrid | @theokit/sdk persistence | low | db/index.ts:74 | `openSqliteResilient` schema-agnóstico |
| Eval seed→agent→verify-gate (exit code) | eval-harness | missing-primitive | hybrid | @theokit/sdk eval+sandbox | medium | eval-suite.ts:104 | Scorer por exit-code via Sandbox |
| RepoProvisioner (clone+checkout isolado) | eval-harness | missing-primitive | hybrid | @theokit/sdk sandbox | low | swebench-provision.ts:40 | `provisionRepo` portável Local/Docker/E2B |
| Runner batch resiliente (resume + flush JSONL) | eval-harness | missing-primitive | hybrid | @theokit/sdk eval | high | swebench-batch.ts:182 | Eval multi-hora crash-safe e resumível |
| Adapters tool-result→props UI | ui-surface | missing-primitive | hybrid | @theokit/ui | high | activity-helpers.ts:54 | Contrato versionado sdk-tools↔ui |
| Montagem de `AgentStreamItem[]` (history+live) | ui-surface | dx-friction | hybrid | @theokit/ui | medium | chat-pane.tsx:150 | `toAgentStreamItems({history,live})` |
| `splitUsagePoints` / `toUsageMetrics` | ui-surface | dx-friction | hybrid | @theokit/ui | low | activity-helpers.ts:273 | Props `splitSeries`/`maxScale` no chart |
| `toModelOption` (humanizar slug OpenRouter) | ui-surface | dx-friction | hybrid | @theokit/sdk | low | activity-helpers.ts:323 | `parseModelId` público + `humanizeModelName` |
| `toTaskPlanNodes` (TodoItem→PlanNode) | ui-surface | missing-primitive | hybrid | @theokit/sdk-tools | medium | activity-helpers.ts:403 | Adapter versionado; tool emite items estruturados |
| Loader dataset JSONL (eval) | eval-harness | missing-primitive | hybrid | @theokit/sdk eval | low | swebench-dataset.ts:46 | `loadJsonl` genérico → DatasetEntry[] |
| `<memories>` combinado (doc + facts) | memory-plan-skills | doc-gap | app | n/a | medium | memory-store.ts:116-131 | `runActiveMemory` já existe (blocking recall) |
| Atomic write reimplementado | project-config | dx-friction | app | n/a | medium | app-config.ts:3; theocode-doc.ts:3 | Usar `atomicWriteText`/`withFileLock` do SDK |
| Persistência+onboarding OpenRouter key | project-config | legit-app-concern | app | n/a | low | app-config.ts:12-49 | Boundary correto; só threadar envVars do profile |
| Migration drizzle-kit (ensureColumn à mão) | persistence | dx-friction | app | n/a | high | db/index.ts:62 | `theokit db push` já existe (nascido de incidente) |
| Logger middleware reimplementa `logRequest` | http-layer | doc-gap | app | n/a (theokit) | medium | logger.middleware.ts:7-11 | `logRequest` já wired no pipeline; deletar |
| Adapter env-driven de web-search | tools-guards | legit-app-concern | hybrid | @theokit/sdk-tools | low | web-search.ts:19-41 | Reference adapters (Brave/Tavily) opcionais |
| PermissionEngine+definePlugin wiring | sdk-integration | legit-app-concern | hybrid | @theokit/sdk | low | permission.plugin.ts:136-188 | Wiring exemplar; só falta default-deny |

---

## 3. Deve ser do framework (boundary = framework e hybrid)

Agrupado por package-alvo. Estes são os 48 gaps cujo mecanismo genérico pertence ao ecossistema.

### 3.1 `@theokit/sdk` — núcleo do agent runtime

O package com mais lacunas. A maioria é "expor/ligar primitivo já existente".

- **Chamar `nextIteration()` no loop** (`internal/agent-loop/loop.ts`, ~linha 217 junto ao `track()`). Adicionar `nextIteration?(): void` à interface `BudgetTracker` (ambos os trackers já implementam) e chamá-lo 1x por turno. Teste: `createCounterBudgetTracker({maxIterations:N})` halt após N. Corrigir o comentário do theocode que diz "type-only" (token+USD JÁ são enforced).
- **Expor o teto interno + driver de continuação determinístico.** Adicionar `maxIterations`/`budget` ao `SendOptions` e mapear via `real-local-run` `buildInputs` (o loop já honra `inputs.maxIterations`). Shipar `agent.runToCompletion(message, { stepBudget, onTruncated })` que detecta truncamento por sinais de round e re-envia histórico acumulado, com terminais explícitos (`done`/`step_limit`/`no_progress`). Deixar a reflection-ladder de domínio no theocode.
- **Promover compaction imperativa pública.** Exportar `compactTranscript({ messages, keepTokens|keepNewest, summarize })` reusando o `selectCompressionWindow`+`compressConversationWindow` internos; `buildCheckpoint`+`filterFromLatestCheckpoint`+`CHECKPOINT_MARKER`; `isContextOverflowError(err)`. Fazer `@ContextWindow`/`AutoSummarize` compilarem para chamadas nessa superfície.
- **Surfacing do código `context_too_long`.** Corrigir `registerLoopError` (`loop-llm-stream.ts:146-148`) p/ preferir `cause.metadata?.code` (canônico) sobre `cause.code` (prefixado); adicionar `code?: string` ao evento `error` do stream (`llm/types.ts:103`) e propagá-lo. Contract test 400→`context_too_long`.
- **`buildReplayHistory(base, events, { contextWindowTokens, ... })`** — serializa AgentEvent→StoredMessage, trunca item gigante (reusar `truncateWithMarker` de `context-loaders.ts`), trima por char-budget derivado do context window. Pure, sem deps.
- **Token budget** — `estimateTokens(text)` + `shouldCompact({estimated, contextWindow, buffer, maxOutput})` em `internal/runtime/context/token-budget.ts`. Heurístico (chars/4), SEM tokenizer (KISS). Liga `getContextWindowConfig` ao runtime.
- **Hook `stop` / onWouldTerminate** — disparar o `HookEvent "stop"` já declarado em `continueOrTerminate`, honrando decisão `feedback` como re-prompt bounded; + accessor tipado de tool-result em `AgentEvent`.
- **Skills em dir arbitrário** — subpath `@theokit/sdk/skills` com `discoverSkills(dir)` (refatorar `SkillsManager.refresh()` p/ aceitar dir) + `buildSkillsBlock(skills)` (extrair render `<skills>` interno).
- **Reader/writer de project-instructions** — subpath `@theokit/sdk/project-instructions`: `readProjectInstructions(cwd, { filename, scope, maxBytes })` (wrapper sobre `walkUpForFile`/`runDiscovery` já existentes) + `writeProjectInstructions` atômico guardado por `safePathJoin`. Tornar THEO.md configurável (hoje `cwd-only`).
- **Repo-map/env-context** (alternativamente em sdk-tools) — `buildEnvContext(cwd)` + `buildRepoMap(cwd, {budget, ignore, rootMarkers})`, node:fs-only, char-bounded, never-throw. Dá executor ao `@ProjectContext`.
- **Tool scoping por AgentDefinition** — adicionar `tools?: ReadonlyArray<string>` ao `AgentDefinition` + frontmatter `tools:`; enforcement reusando `withToolWhitelist`/`vetoFromForkWhitelist` (já wired p/ fork). NÃO rotear via PermissionEngine (zero callers).
- **`default-deny` no PermissionEngine** — adicionar `defaultAction: PermissionAction` (default `"allow"`); trocar `return "allow"` final por `return this.defaultAction`. 1 linha, backward-compatible.
- **Readers de SDKMessage** — subpath `./messages`: `assistantText(msg)`, `extractToolUses(msg)`, helpers de usage/cost preservando `amountUsd: number|undefined` (ADR-D377, nunca 0).
- **Catálogo per-model** — promover `resolveModelCapabilities(modelId)` (hoje `@internal`, dead) ao público; corrigir `capabilities()` p/ não descartar o sufixo do slug OpenRouter. Sync + offline, `undefined` p/ desconhecido.
- **`@theokit/sdk/concurrency`** — promover `createSemaphore` + `mapWithConcurrency<T,R>(items, concurrency, fn)` ordenado. Dedupe das 5 cópias internas (`batch.ts`, `step-foreach.ts`, `step-parallel.ts`, `task/registry.ts`).
- **`withRetry`** — subpath `@theokit/sdk/retry`: `withRetry(fn, { retries, isRetryable, delayMs, sleep, signal })` com `sleep` injetável (testabilidade) e signal OPCIONAL. Internal `withRetry` do workflow delega.
- **`isTransientError(err: unknown)`** em `errors.ts` (re-export no index) — consolida `defaultRetriableForCode` + status set {408,409,425,429,500,502,503,504} + transport codes {ECONNRESET,...}. NÃO incluir regex sobre `err.message` (deixar como último recurso app-side).
- **`safeFilenameForId(id, { maxLen? })`** em path-safety — aceita qualquer string (incl. leading `-`/`_`), produz token `[0-9a-f]` determinístico (sha256). Migrar as 4 respostas divergentes (`sanitizeIdentifier`, `sanitizeRunId`, hash do theocode, supermemory).
- **SQLite resiliente** — extrair `openSqliteResilient({ filePath, onOpen })` (corruption-recovery hoje preso em sdk-memory `openMemoryDb`) p/ `internal/persistence`; theocode consome `applyWalWithFallback` (já público).

### 3.2 `@theokit/sdk-tools` — toolbox de code-assistant

- **SSRF guard** — `isBlockedAddress(ip)`/`resolveAndScreen(host)` (resolve TODOS os A-records, bloqueia private/loopback/link-local/metadata, normaliza IPv4-mapped IPv6) + `blockPrivateNetwork?: boolean` (default true em `createGuardedWebFetchTool`) + `redirect:'manual'`. Follow-up: pin de DNS via undici dispatcher.
- **`catastrophicShellReason(command): string | null`** — segment-aware (split em `;`/`&&`/`||`/`|`), per-rm inspection, `curl|sh` RCE, mkfs/dd, fork bomb, force-push/reset --hard, secret exfil. Opt-out `screenCatastrophic?: boolean` (default true). Guardrail, NÃO sandbox.
- **Rich errors na fonte** — cada factory anexa `guidance` ao seu próprio payload de falha (já possui o shape exato). + wrapper `withToolResultGuidance(tool, mapper?)`. NÃO empurrar p/ dispatch core.
- **`withDescription(tool, description)` + `renderToolList(tools|names)`** — override de descrição (copy-agnóstico) e render do bloco `<tools>` do mesmo source-of-truth. Copy rica fica no app.
- **Plan-mode persistence** — `createSessionArtifactStore({ dir, idStrategy })` (generalizar `session-summary-writer.ts`) + composição opt-in no `createPlanModeTool`.
- **`buildEnvContext`/`buildRepoMap`** (ver 3.1) — sibling de read-file/list-dir/glob-files.
- **Reference adapters de web-search** (opcional, YAGNI: começar com 1) — `braveWebSearchAdapter`/`tavilyWebSearchAdapter` espelhando `MEMORY_EMBEDDING_ADAPTERS`. Manter `createWebSearchTool` provider-agnóstico.
- **`todoItemsToPlanNodes(items): PlanNode[]`** — adapter versionado + tool emitindo items ESTRUTURADOS no result (hoje só `items_summary` string; `getItems()` não chega à persistência → bug latente no theocode que retorna `[]`).

### 3.3 `@theokit/ui` — superfície de agente

- **`AgentToolRenderer`** — despacha tool invocation p/ o componente mais rico (DiffViewer/TerminalPanel/CodeBlock/CreatedFilesCard/DataTable/SourceUrlPart), com registry overridable e fallback p/ ToolCallPart. A própria screen `theo-code-shell.tsx:812` já reimplementa à mão.
- **`@theokit/ui/sdk-tools-adapters`** (subpath co-versionado) — `toDiffModel`/`toTerminalLines`/`toCodeModel`/`toGlobFiles`/`toSearchMatches`/`toWebSources` + contract test importando as factories reais de sdk-tools.
- **`useStickToBottom` (ou prop `followOutput`)** — ResizeObserver + threshold + programmatic-scroll guard + pending-jump em troca de sessão. Encapsula o seletor Radix `[data-radix-scroll-area-viewport]` (hoje vazado no app).
- **`toAgentStreamItems({ history, live }, { classifyTool })`** — interleave order-aware de histórico persistido + estado live; classificação tool→ActivityPanel injetável.
- **Props `splitSeries`/`maxScale` no `TokenUsageChart`** — input replayed afoga output; auto-scale esconde headroom real.

### 3.4 `theokit/client`

- **`liveText` + `error` derivados** em `UseAgentStreamReturn` (o template default do `create-theokit` JÁ hand-rolla `switch(event.type)` — dogfood).
- **`foldAgentToolCards(events)` + `useAgentToolCards(path)`** — correlação call→result por `id`, card running→success/failed, eventos sem id sem cross-contamination. Resolver de envelope `{isError,result}` injetável.

### 3.5 `theokit` (packages/theo) — HTTP layer

- **`defineHealthRoute`/`defineReadyRoute`** (ou config `health: {...}`) p/ o filesystem-route server — o orquestrador de services JÁ default-polla `/health` (`services/schema.ts:56`), então o framework manda um endpoint que não dá primitivo p/ construir.
- **404/typed exception em defineRoute** — exportar `TheoError`+`fromUnknown`+sugar (`NotFoundException`...) via `theokit/server`; rotear o catch do `executeRoute` legado por `serverErrorToEnvelope`+`envelopeCodeToStatus` (o path Web já faz). Migrar as 5 rotas do theocode.
- **Boot programático** — promover `startDevServer`/`startCommand` a exports públicos (`theokit/boot`). Manter `server/index.ts` convention-only.

### 3.6 `@theokit/sdk-budget`, `@theokit/sdk-memory`, `@theokit/orm`, `@theokit/server/cost`, `@theokit/agents`

- **sdk-budget**: agregação cost-aware honest-null (unknown envenena soma p/ `null`/`unknown`, não $0). Corrigir `createUsdBudgetTracker` p/ marcar total como unknown em modelo sem pricing (`usd-pricing.ts:50 return 0` é o footgun).
- **sdk-memory**: `createCategorizedMemory({ root, categories })` (writeMemory/listMemories/buildContext) reusando `safePathJoin`/`sanitizeIdentifier`/`frontmatter-zod` já públicos; promover `MemoryFact` com `category` opcional.
- **orm**: `createRepository(db, table)` (non-DI, já é `new`-able) + variante sync-aware p/ better-sqlite3 (o async-only é o real motivo do theocode ter evitado). Instalar @theokit/orm no theocode.
- **server/cost**: `UsageRecord.costUsd` nullable + `UsageResult.costKnown: boolean`; CostMeter renderiza `—` em cost unknown.
- **agents**: `catastrophicShellReason` + `denyCatastrophicCommands()` composável com `isCommandAllowed`.

### 3.7 Eval harness (`@theokit/sdk` eval + sandbox)

- **Verify-gate scorer** — `Scorers.commandExit()`/`Scorers.verifyGate({ failToPass, passToPass })`; output = exit-code via `SandboxBackend.execute` (LocalSandbox já retorna `ExecuteResult.exitCode`). `EvalRowResult.artifact { diff, applies }`.
- **`loadJsonl(path, { map? })`** — split/trim/skip-blank/parse + erro tipado com nº de linha. Schema SWE-bench fica no app via `map`.
- **`provisionRepo(sandbox, { repoUrl, ref, instanceId, workRoot })`** — clone+checkout+isolamento via `SandboxBackend.execute` (portável Local/Docker/E2B), `RepoProvisionError` tipado.
- **Runner batch durável** — `appendJsonl(path, record)` + `readJsonlIds(path, keyFn)` em `internal/persistence`; `Eval.run`/`Agent.batch` com `{ persist: { path, key, resume } }` + flush por linha + `classify(result) => string` p/ taxonomia sem o framework owning labels.

---

## 4. Legítimo do app (boundary = app)

O que o theocode corretamente possui — NÃO migrar para o framework.

- **`<memories>` combinado (`memory-store.ts:116-131`)** — `doc-gap`. O primitivo de blocking-recall JÁ EXISTE (`runActiveMemory` retorna `systemPromptAdditions`, wired em `loop-context-init.ts:103-122` no bloco `<active-memory>` priority 5). Ação: corrigir o comentário factualmente errado ("não indexa markdown" — falso, há FTS5+vectors via `chunkMarkdown`+`IndexManager`) e migrar do dump verbatim para `memory.activeRecall` + `MemoryProvider`. É behavior change (recall ranqueado, cap 5), não drop-in.
- **Atomic write (`app-config.ts:3`, `theocode-doc.ts:3`)** — `dx-friction`. O SDK já shipa `atomicWriteText`/`atomicWriteJson`/`replaceFileAtomic`/`withFileLock` (auditados: crypto-random, 0o600, fsync) via `@theokit/sdk/internal/persistence`. A versão hand-rolled é INFERIOR (sem fsync, sem 0o600 — a API key fica world-readable na janela open→rename, sem lock inter-processo). Ação app: deletar `memory-store.ts:11-15` e usar os primitivos. Boundary é app porque nada falta no framework.
- **Persistência+onboarding da OpenRouter key (`app-config.ts:12-49`)** — `legit-app-concern`. Escolher OpenRouter, o `.theocode/config.json`, o gate `hasOpenRouterApiKey` e o contrato secret-never-returned são decisões de produto. O framework JÁ modela providers (`ProviderProfile.envVars` + `resolveApiKey`). Único refinamento: threadar `getProviderProfile("openrouter").envVars` em vez do literal hardcoded (hoje checa só `OPENROUTER_API_KEY`, drift silencioso vs o profile que também aceita `OPENAI_API_KEY`).
- **Migration drizzle-kit (`db/index.ts:62`)** — `dx-friction`, mas a CORREÇÃO é app. O `ensureColumn` nasceu de um incidente real ("old dev DB lacked these, so every appendMessage failed"). O ecossistema JÁ shipa `theokit db generate|migrate|push` + `check-schema-drift`, e a própria skill `theokit-database` manda `npx drizzle-kit push`. Ação: deletar o runner bespoke e dirigir `schema.ts` via `theokit db push`; wire `check-schema-drift` no CI.
- **Logger middleware (`logger.middleware.ts:7-11`)** — `doc-gap`. `logRequest` (theokit/server/observability) já é invocado pelo pipeline e é estruturado/devtools-aware. O middleware é estritamente inferior E doubly-orphaned (implementa contrato `@theokit/http` NestMiddleware ligado ao `TheoApp.create({controllers:[]})` que NÃO é o serving path real do theocode). Ação: deletar; se quiser sink custom, passar `LoggerFn`.

**Observação sobre os "app concerns":** vários (`atomic write`, `migration`, `logger`, `<memories>`) são na verdade **violações de Regra 9 (não reinvente) dentro do theocode** — o primitivo existe e é superior, o app só não o descobriu/adotou. Isso reforça o tema de discoverability da Seção 5.

---

## 5. Oportunidades (por tema)

### Tema A — Harness completo de agente (a maior alavancagem)

O agent runtime tem os buracos mais severos e mais universais. Hoje, construir um agente long-running sobre `@theokit/sdk` significa silenciosamente:
- perder trabalho ao exceder 8 tool calls (teto interno sem knob),
- não ter step-cap funcional (`nextIteration()` morto),
- copiar compaction de OpenCode,
- reconstruir continuation-history, reflection ladder, usage aggregation e retry.

**Fechar o Tema A = transformar `agent.send` (single-shot) num substrato real.** É a diferença entre "demo que trava em 8 tools" e "agente que termina um refactor de verdade". Prioridade máxima: `nextIteration()` + `runToCompletion`/continuation driver + `compactTranscript` público + `isTransientError`.

### Tema B — Gestão de contexto

Sub-tema do A, mas coeso: compaction imperativa, `buildReplayHistory`, `estimateTokens`/`shouldCompact`, `context_too_long` no boundary, catálogo per-model context-window. Tudo gravita em torno de "quantos tokens cabem e o que fazer quando estoura". O SDK tem ~90% disso `@internal` ou reativo; falta expor o lado proativo/imperativo e dar runtime aos decorators (`@ContextWindow`).

### Tema C — Toolbox de code-assistant (segurança + DX de tools)

`@theokit/sdk-tools` shipa as tools mas não os guard-rails nem os adapters: SSRF guard, screen de shell catastrófico, rich-errors (recuperação de modelo fraco), ACI descriptions, plan-mode persistence, repo-map. A assimetria gritante: o SDK shipa egress de filesystem (`safePathJoin`, `assertNoSymlinkEscape`) mas NENHUM análogo de network/shell egress — mesma categoria de segurança, metade coberta. **Duas reinvenções independentes já existem** (theocode + telegram-pro hand-rollam shell denylist), o que satisfaz a Regra-de-3.

### Tema D — Superfície de UI de agente

A ponte entre `theokit/client` (eventos crus) e `@theokit/ui` (componentes presentation-only) está faltando inteira: `foldAgentToolCards`, `liveText`/`error`, `AgentToolRenderer`, adapters tool→props, `useStickToBottom`, `toAgentStreamItems`. **O sinal mais forte: a própria screen de showcase do `@theokit/ui` (`theo-code-shell.tsx`) e o template default do `create-theokit` reimplementam à mão os primitivos faltantes.** Quando o showcase do framework reinventa o primitivo, o primitivo pertence ao framework.

### Tema E — Eval harness

O SDK shipa runner (dataset→agent→scorer texto), `Agent.batch`, Sandbox e git-diff — mas falta a cola que transforma "agente editou um repo" em "aqui está o patch, e ele aplica": verify-gate por exit-code, `loadJsonl`, `provisionRepo`, runner batch resiliente (resume + flush). Runs SWE-bench são multi-hora e $-heavy; a ausência de resume/flush incremental força todo consumidor sério a reconstruir crash-durability. Severidade HIGH pela assimetria custo/tempo.

### Tema F — Scaffolding / CLI / persistência

`@theokit/orm` Repository não-adotado (async-only + DI-first são as barreiras reais), migration drizzle-kit não-usada (incidente de produção), SQLite bootstrap sem corruption-recovery, `safeFilenameForId` com 4 respostas divergentes. Tema de "o framework tem a ferramenta, o app não a alcançou" — metade é discoverability, metade é ergonomia (lowering walls como sync-aware repo + non-DI entry).

### Tema G — Descoberta / Docs (o meta-tema)

**Vários gaps NÃO são capacidade faltante — são primitivos existentes invisíveis.** `runActiveMemory` (blocking recall completo, wired), `atomicWriteText`/`withFileLock` (auditados), `logRequest` (já no pipeline), `theokit db push` (mandado pela própria skill), `resolveModelCapabilities` (dead code interno), `createSemaphore` (5 cópias internas). Recomendação transversal: **um inventário de capacidades público e mantido** + promover `@internal` selados para barrels públicos documentados. A regra de ouro: se o theocode (construído por quem conhece o stack) reinventou, um terceiro NUNCA vai descobrir.

---

## 6. Observação sobre di / gateways / plugins

**Fato observado:** o uso real (theocode) NÃO tocou `theokit-di`, `theokit-gateways`, nem a camada de decorators de `@theokit/agents` para a integração de agente. As referências confirmam:

- O theocode wira o agente **imperativamente** (`defineTool` + `Agent.create`/`agent.send`), explicitamente NÃO com `@Agent`/`@Tool` (o próprio CLAUDE.md do theocode declara isso).
- `@theokit/orm` (parte do theokit-di) **nem está instalado** no `node_modules/@theokit/` do theocode (há di, di-agent, sdk, sdk-tools, ui, http — mas não orm).
- Toda a camada de decorators que aparece nos gaps (`@ContextWindow`, `@ProjectContext`, `@Skills`, `AutoSummarize`, `@Hook`, `@Checkpoint`) é **metadata-only / não-enforced** — `getContextWindowConfig`/`getProjectContextConfig` não têm consumidor de runtime, e `AgentWarningCode` documenta decorators como não-enforced.

**O que isso sugere:**

1. **A camada imperativa é o caminho real, a declarativa é aspiracional.** O consumidor de referência escolheu factory functions + injeção explícita sobre decorators + DI container. Isso valida a Regra 9 do próprio time ("factory functions são canônicas, decorators são açúcar sobre uma superfície low-level real") — mas expõe que o açúcar **não tem o substrato** em vários casos. Decorator sem runtime é bug latente, não feature.

2. **`theokit-di`/`theokit-gateways` podem estar resolvendo problemas que o consumidor de agente não tem.** O theocode usa `theokit/server/define` (filesystem routes) + `defineRoute`, não `TheoApp`/`@Controller`/DI container. As duas superfícies HTTP (convention dev-server vs imperative TheoApp) são **paralelas e não compartilham primitivos** (health, middleware, logging) — tensão dual-surface que recorre nos gaps de http-layer. Sugere que o investimento em di/decorators/gateways pode estar desalinhado com o shape mais comum de app de agente (local-first, síncrono, file-based routes, imperativo).

3. **Recomendação:** antes de investir mais na camada declarativa/DI, **dar runtime ao que já foi declarado** (ligar os decorators existentes aos primitivos imperativos da Seção 3) e **consolidar as duas superfícies HTTP** em torno dos mesmos primitivos. Um agente builder não deveria escolher entre "convention sem health/logRequest tipado" e "TheoApp que não serve as rotas do `theokit dev`". A ausência de uso de di/gateways pelo consumidor de referência é um sinal a investigar — não necessariamente de que são desnecessários, mas de que o on-ramp imperativo (o que as pessoas realmente usam) está faltando peças que esses pacotes não preenchem.
