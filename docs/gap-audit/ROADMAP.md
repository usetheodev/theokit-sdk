# Roadmap — Fechamento dos Gaps do Ecossistema Theo

> Plano de execução para resolver os **52 gaps confirmados** em `THEOKIT_GAP_AUDIT.md`.
>
> Objetivo-norte: qualquer pessoa constrói um agente / code-assistant sobre o ecossistema Theo sem reinventar plumbing genérico. O `theocode` deixa de ser "prova de que dá" e passa a ser "exemplo de quão pouco código o app precisa".
>
> Eixo: milestones de valor (M0–M8), cada item taggeado com repo · package, esforço e dependências.

---

## Como ler

- **Esforço** — `S` = expor/promover/deletar ou 1–2 arquivos contidos; `M` = primitiva nova contida com testes; `L` = primitiva com design não-trivial (driver de continuação, compaction público, renderer, runner durável).
- **Sev** — severidade do gap na auditoria (`high`/`med`/`low`).
- **Depende de** — IDs que precisam estar prontos antes (ou `—` quando independente).
- **Repo · Package** — onde o trabalho acontece. São repositórios git independentes; cada milestone que cruza repos exige coordenar mais de um release.
- Detalhe técnico completo de cada ação está na **Seção 3 do `THEOKIT_GAP_AUDIT.md`** — aqui fica o resumo de 1 linha.

### Repos envolvidos

| Tag | Repo | Packages tocados |
|---|---|---|
| `sdk` | theokit-sdk | @theokit/sdk, sdk-tools, sdk-budget, sdk-memory |
| `fw` | theokit-a | theokit (packages/theo), theokit/client |
| `ui` | theo-ui | @theokit/ui |
| `di` | theokit-di | @theokit/orm |
| `app` | theocode | correções de Regra 9 (consumidor) |

---

## Visão geral e ondas de execução

```
M0 Fundação ───────────┬──────────────┬───────────────┬─────────► (destrava tudo)
                       │              │               │
   ┌───────────────────┘              │               │
   ▼                                  ▼               ▼
M1 Harness confiável            M3 Toolbox segura   M7 HTTP/persistência
   │        │                        │   │           (quase independente)
   ▼        ▼                        ▼   ▼
M2 Contexto  M6 Eval harness    M4 Skills/memória/projeto
   │            ▲                     │
   │            └──────(M1+M3)        ▼
   └──────────┐                  M5 UI de agente
              ▼                       │
          M8 Runtime dos decorators ◄─┴──(M2+M3+M4)
```

| Onda | Milestones (paralelizáveis) | Tema | Por quê agora |
|---|---|---|---|
| 1 | **M0**, M3 (início), M7 | Fundação, segurança, HTTP | Sem dependências; M0 destrava todo o resto |
| 2 | **M1**, M4 | Harness, consciência de projeto | Substrato do agente; dependem de M0 |
| 3 | **M2**, M5, M6 | Contexto, UI, eval | Dependem de M1/M3/M4 |
| 4 | **M8** | Camada declarativa | Liga decorators aos primitivos das ondas 1–3 |

---

## M0 — Fundação: expor o que já existe e pagar a dívida da Regra 9

> **Status: lado SDK RELEASED** em `@theokit/sdk@2.1.0` (npm, 2026-06-19) — M0-1..M0-5. Lado theocode: M0-6/M0-8 feitos em `develop` (READY_TO_MERGE, ainda não released); M0-7/M0-9/M0-10 deferidos (ver `theocode/.claude/knowledge-base/discoveries/blueprints/m0-deferred-items-blueprint.md`).

**Valor entregue:** elimina reinvenções inferiores dentro do próprio theocode e promove para o barrel público primitivas que já existem `@internal`. Maior razão valor/esforço do roadmap — quase tudo aqui é `S`/`M` e destrava milestones seguintes.

| ID | Gap | Repo · Package | Sev | Esf | Depende de | Ação |
|---|---|---|---|---|---|---|
| M0-1 ✅ | `isTransientError` não público | sdk · errors.ts | high | S | — | Consolidar `defaultRetriableForCode` + status set + transport codes num predicado exportado. Sem regex sobre `message`. |
| M0-2 ✅ | `mapWithConcurrency`/`createSemaphore` (5 cópias internas) | sdk · concurrency | med | M | — | Promover semaphore + pool ordenado bounded; dedupe das 5 cópias internas. |
| M0-3 ✅ | `withRetry` genérico (clock injetável) | sdk · retry | med | S | M0-1 | Subpath `@theokit/sdk/retry` com `sleep`/`signal` injetáveis; workflow interno delega. |
| M0-4 ✅ | `safeFilenameForId` (4 respostas divergentes) | sdk · path-safety | low | S | — | `safeFilenameForId(id,{maxLen})` determinístico; migrar as 4 variantes. |
| M0-5 ✅ | SQLite resiliente (corruption-recovery preso em sdk-memory) | sdk · persistence | low | M | — | Extrair `openSqliteResilient({filePath,onOpen})` para `internal/persistence`. |
| M0-6 ✅ | Atomic write reinventado (inferior: sem fsync/0o600) | app · theocode | med | S | — | FEITO 2026-06-19 (commit 12a1029): adotado `replaceFileAtomic` do SDK; 5 writers async; regression test 0o600. |
| M0-7 ⏸️ | Migration `ensureColumn` à mão (nasceu de incidente) | app · theocode | high | S | — | DEFERIDO — não bloqueado pelo SDK, mas deletar regride o incidente; precisa task própria (migrations versionadas + CI drift) antes de remover. Ver blueprint m0-deferred-items. |
| M0-8 ✅ | Logger middleware reimplementa `logRequest` (doubly-orphaned) | app · theocode | med | S | — | FEITO 2026-06-19 (commit 9915703): órfão deletado. |
| M0-9 ⏸️ | `<memories>` dump verbatim em vez de recall ranqueado | app · theocode | med | M | — | BLOQUEADO — `runActiveMemory` não está no barrel público do SDK 1.9.0; exige SDK expor recall OU rewire de `MemoryProvider`. Ver blueprint m0-deferred-items. |
| M0-10 ⏸️ | OpenRouter key checa literal hardcoded | app · theocode | low | S | — | BLOQUEADO — `getProviderProfile` não está no barrel público do SDK 1.9.0; baixa severidade. Ver blueprint m0-deferred-items. |

**Concluído quando:** zero reinvenções inferiores no theocode; utilitários (retry/concurrency/path/transient/sqlite) no barrel público com testes.

---

## M1 — Harness de agente confiável (Tema A — maior alavancagem)

> **Status: CONCLUÍDO (6/6) — TODOS RELEASED no npm.** RELEASED em `@theokit/sdk@2.2.0` (2026-06-20) — M1-1 + M1-2. RELEASED em `@theokit/sdk@2.3.0` (2026-06-20): `agent.runToCompletion` + M1-3 `buildReplayHistory`. **M1-4 (`stop` hook + bounded feedback) + M1-5 (`@theokit/sdk/messages` readers) RELEASED em `@theokit/sdk@2.4.0` (npm, 2026-06-22)** — via token (PR #29 Version Packages merged; OIDC trusted-publisher não configurado). **M1-6 (`@theokit/sdk-budget` honest-null cost) RELEASED em `@theokit/sdk-budget@0.2.0` (npm, 2026-06-22).** Nota: as tags manuais `v3.0.0`/`v3.1.0`/`v3.2.0` não correspondem ao modelo changesets — o changeset publish consolidou tudo em `@theokit/sdk@2.4.0`. Tema A completo.

**Valor entregue:** `agent.send` deixa de ser single-shot frágil e vira substrato real. A diferença entre "demo que trava em 8 tools" e "agente que termina um refactor".

| ID | Gap | Repo · Package | Sev | Esf | Depende de | Ação |
|---|---|---|---|---|---|---|
| M1-1 ✅ (2.2.0) | `budgetTracker.nextIteration()` morto no loop | sdk · @theokit/sdk | high | S | — | Chamar `nextIteration()` 1x/turno no loop; ambos os trackers já implementam. Teste: halt após N. |
| M1-2 ✅ (knob+sinal em 2.2.0; runToCompletion ✅ RELEASED 2.3.0) | Teto interno de 8 passos sem knob + driver de continuação | sdk · @theokit/sdk | high | L | M1-1, M0-1 | Expor `maxIterations`/`budget` em `SendOptions`; shipar `agent.runToCompletion(msg,{maxRounds,continuationPrompt,onTruncated,signal})` com detecção de truncamento via `stoppedAtIterationLimit` e terminais (`done`/`step_limit`/`no_progress`). Sessão stateful preserva histórico → `buildReplayHistory` (M1-3) não é necessário aqui. |
| M1-3 ✅ (RELEASED `@theokit/sdk@2.3.0`) | Continuation-history (event→replayable bounded) | sdk · @theokit/sdk | med | M | M1-2 | `buildReplayHistory(base,events,{contextWindowTokens,reserveTokens?,perItemCap?})` puro, reusando `truncateWithMarker`; mapeia SDKMessage→StoredMessage, drop-oldest pair-safe por `call_id`, exportado do barrel. Plan SHIPPABLE 94.8, blueprint 99.7, commits `54a9f72`+`d7d5215`+`0ffa3ac` (2026-06-20). |
| M1-4 ✅ (RELEASED `@theokit/sdk@3.0.0`) | Reflection ladder / hook `stop` nunca dispara | sdk · @theokit/sdk | med | M | M1-2 | Disparar o `HookEvent "stop"` já declarado; honrar `feedback` como re-prompt bounded; accessor tipado de tool-result. Commits `fb268f9`+`074a5a2`. |
| M1-5 ✅ (RELEASED `@theokit/sdk@3.0.0`) | Stream-message → wire-event mapper + readers de SDKMessage | sdk · @theokit/sdk | med | M | — | Subpath `./messages`: `assistantText`/`extractToolUses` + `costAmountUsd` (preserva `amountUsd: number\|undefined`, nunca 0 — ADR D377). Plan SHIPPABLE 98.0, blueprint 98.8, commits `69763c7`+`a21949f` (2026-06-20). |
| M1-6 ✅ (READY_TO_MERGE — review 2026-06-21) | Agregação de usage multi-round (honest-null) | sdk · sdk-budget | low | M | M1-5 | `unknown` envenena a soma para `null`/`unknown`, nunca $0. Corrigir `usd-pricing.ts:50 return 0`. |

**Concluído quando:** agente roda > 8 tool calls de forma confiável; step-cap fail-closed funciona em 1 linha; custo reportado é honesto.

---

## M2 — Gestão de contexto (Tema B)

> **Status: CONCLUÍDO (4/4) — TODOS RELEASED no npm.** M2-1 (`@theokit/sdk/compaction`), M2-2 (estimateTokens/shouldCompact), M2-3 (context_too_long no boundary), M2-4 (`@theokit/sdk/models` + OpenRouter slug fix) **RELEASED em `@theokit/sdk@2.4.0` (npm, 2026-06-22)** — via token (PR #29 merged). **M2 CONCLUÍDO** — Tema B completo.

**Valor entregue:** o agente sobrevive a transcripts que crescem além da janela — modo de falha #1 de agentes de chat em produção.

| ID | Gap | Repo · Package | Sev | Esf | Depende de | Ação |
|---|---|---|---|---|---|---|
| M2-1 ✅ (RELEASED `@theokit/sdk@3.1.0`) | Compaction não exposta (algoritmo está `@internal`) | sdk · @theokit/sdk | high | L | M1-2 | Subpath `@theokit/sdk/compaction`: `compactTranscript({messages,keepRecent,summarize?})` (reusa `selectCompressionWindow` interno) + `buildCheckpoint`/`filterFromLatestCheckpoint`/`CHECKPOINT_MARKER` (string-sentinel visível) + `isContextOverflowError` (code tipado `context_too_long`). Opera sobre `CompressibleMessage`; zero deps. Blueprint 98.8, plan 93.2, commits `1fdfff0`+`5b8c9e7`+`9586ab8`. |
| M2-2 ✅ (READY_TO_MERGE 2026-06-21) | Token estimate + `shouldCompact` (decisão pré-call) | sdk · @theokit/sdk | low | M | — | `estimateTokens` (chars/4, sem tokenizer) + `shouldCompact({estimated,contextWindow,buffer})`. |
| M2-3 ✅ (READY_TO_MERGE 2026-06-21) | Erro `context_too_long` não chega ao boundary | sdk · @theokit/sdk | med | M | M1-5 | Preferir `cause.metadata?.code`; adicionar `code?` ao evento `error` do stream; contract test 400→`context_too_long`. |
| M2-4 ✅ (READY_TO_MERGE 2026-06-21) | Catálogo per-model context-window (dead `@internal`) | sdk · @theokit/sdk | med | M | — | Promover `resolveModelCapabilities` ao público; corrigir descarte do sufixo do slug OpenRouter; sync/offline. |

**Concluído quando:** compaction é importável; overflow é tipado, não regex; janela por modelo é consultável offline.

---

## M3 — Toolbox segura + orientação no repo (Tema C)

> **Status: CONCLUÍDO — RELEASED no npm.** Os 7 itens M3-1..M3-7 (todos em `@theokit/sdk-tools`, zero deps) **RELEASED em `@theokit/sdk-tools@0.2.0` (npm, 2026-06-22)** — via token (PR #29 merged; a tag manual `v3.2.0` não corresponde ao changeset, que publicou sdk-tools@0.2.0). Cada item passou pelo cycle completo discover→plan→implement→code-quality→review até READY_TO_MERGE. M3-6 foi entregue em `sdk-tools` como predicado puro composável — KISS.

**Valor entregue:** fecha a assimetria de segurança (o SDK protege egress de filesystem mas não de rede/shell) e dá ao agente a capacidade de se orientar num codebase. Paralelizável com M1/M2.

| ID | Gap | Repo · Package | Sev | Esf | Depende de | Ação |
|---|---|---|---|---|---|---|
| M3-1 ✅ (RELEASED v3.2.0) | SSRF guard ausente em `web_fetch` | sdk · sdk-tools | high | M | — | `resolveAndScreen(host)` (todos os A-records; bloqueia private/loopback/link-local/metadata; IPv4-mapped IPv6) + `redirect:'manual'`; default-on em `createGuardedWebFetchTool`. |
| M3-2 ✅ (RELEASED v3.2.0) | Screen de shell catastrófico ausente | sdk · sdk-tools | high | M | — | `catastrophicShellReason(cmd)` segment-aware (rm/`curl\|sh`/mkfs/dd/fork-bomb/force-push/exfil); opt-out default-on. Guardrail, não sandbox. |
| M3-3 ✅ (RELEASED v3.2.0) | Repo-map / env-context builder | sdk · sdk-tools | high | L | — | `buildEnvContext(cwd)` + `buildRepoMap(cwd,{budget,ignore})` node:fs-only, char-bounded, never-throw. |
| M3-4 ✅ (RELEASED v3.2.0) | Rich errors (self-correction em tool fail) | sdk · sdk-tools | med | M | — | Cada factory anexa `guidance` ao próprio payload; wrapper `withToolResultGuidance`. |
| M3-5 ✅ (RELEASED v3.2.0) | ACI description override + render `<tools>` | sdk · sdk-tools | med | S | — | `withDescription(tool,desc)` + `renderToolList` do mesmo source-of-truth. |
| M3-6 ✅ (RELEASED v3.2.0) | Catastrophic shell na camada de agents | sdk · @theokit/agents | low | S | M3-2 | `denyCatastrophicCommands()` composável com `isCommandAllowed`. |
| M3-7 ✅ (RELEASED v3.2.0) | Web-search adapter env-driven (opcional, YAGNI: 1 primeiro) | sdk · sdk-tools | low | S | — | `braveWebSearchAdapter`/`tavilyWebSearchAdapter`; manter `createWebSearchTool` provider-agnóstico. |

**Concluído quando:** `web_fetch` é safe-by-default contra SSRF; `shell_exec` tem backstop; `buildRepoMap` orienta o LLM em 1 call.

---

## M4 — Memória, skills, plano e instruções de projeto

**Valor entregue:** "o agente sabe do projeto" deixa de ser código de app. Skills, memória categorizada, plano durável e leitura hierárquica de instruções viram primitivas.

> **Status: CONCLUÍDO (6/6) — TODOS RELEASED no npm (2026-06-22, via token, PR #29 merged).** M4-1 `@theokit/sdk/skills` + M4-2 `@theokit/sdk/project` + M4-6 `@theokit/sdk/subagents` tool scoping → **`@theokit/sdk@2.4.0`**; M4-3 createCategorizedMemory → **`@theokit/sdk-memory@0.2.0`**; M4-4 createSessionArtifactStore + M4-5 todoItemsToPlanNodes → **`@theokit/sdk-tools@0.2.0`**. Cada item passou pelo cycle completo discover(baseline)→plan→edge-cases→deps-audit→plan-confidence→implement(TDD)→code-quality→review(2 agentes). **M4 CONCLUÍDO** — Tema A (harness completo de agente: skills/memória/plano/instruções/scoping) completo.

| ID | Gap | Repo · Package | Sev | Esf | Depende de | Ação |
|---|---|---|---|---|---|---|
| M4-1 ✅ (READY_TO_MERGE 2026-06-21) | Discovery de skills em dir arbitrário + `<skills>` | sdk · @theokit/sdk | high | M | M0-4 | Subpath `@theokit/sdk/skills`: `discoverSkills(dir)` + `buildSkillsBlock(skills)` (YAML real, symlink-escape guard). |
| M4-2 ✅ (READY_TO_MERGE 2026-06-21) | Reader/writer hierárquico de project-instructions | sdk · @theokit/sdk | med | M | M0-6 | `readProjectInstructions(cwd,{filename,scope})` (sobre `walkUpForFile`) + write atômico; THEO.md configurável. |
| M4-3 ✅ (READY_TO_MERGE 2026-06-21) | Memory taxonomia tipada (markdown + frontmatter) | sdk · sdk-memory | med | M | M0-4 | `createCategorizedMemory({root,categories})` reusando `safePathJoin`/`frontmatter-zod`; `MemoryFact.category` opcional. |
| M4-4 ✅ (READY_TO_MERGE 2026-06-21) | Plan-mode artifact persistence | sdk · sdk-tools | med | M | — | `createSessionArtifactStore({dir,idStrategy})` (generalizar `session-summary-writer`); composição opt-in em `createPlanModeTool`. |
| M4-5 ✅ (READY_TO_MERGE 2026-06-21) | `todoItemsToPlanNodes` + tool emite items estruturados (bug latente) | sdk · sdk-tools | med | M | — | Tool emite items estruturados no result (hoje só string → `getItems()` retorna `[]`); adapter versionado. |
| M4-6 ✅ (READY_TO_MERGE 2026-06-21) | Tool scoping por `AgentDefinition` (hoje só prompt soft) | sdk · @theokit/sdk | med | M | — | `tools?: string[]` em `AgentDefinition` + frontmatter; enforcement via `withToolWhitelist` (NÃO via PermissionEngine). |

**Concluído quando:** sub-agente read-only é provadamente sem Write/Bash; skills/memória/plano/instruções são chamadas de framework, não ~400 LoC de app.

---

## M5 — Superfície de UI de agente (Tema D)

**Valor entregue:** a ponte faltante entre `theokit/client` (eventos crus) e `@theokit/ui` (componentes). Sinal de urgência: o próprio showcase do `@theokit/ui` e o template do `create-theokit` reinventam isto à mão.

> **Status: CONCLUÍDO (8/8). Slice theo-ui RELEASED.** M5 cruza 3 repos: `@theokit/sdk` (M5-8), `theokit/client` (M5-1/M5-2), `@theokit/ui` (M5-3..M5-7). **M5-3..M5-7 RELEASED em `@theokit/ui@0.17.0` (npm `latest`, 2026-06-22)** — PR #14 (release prep) + PR #15 (build/CI fix) merged em main, tag `v0.17.0` → `be2fa31`, GitHub release publicado. O publish do CI (OIDC trusted-publisher) ainda não está configurado no npmjs.com → 0.17.0 publicado via token (sem provenance); `quality:gates` 100% verde no CI após corrigir 6 camadas crônicas (playground typecheck, contract-test ordering, registry M5-3, bundle env-sensitivity, test flake, visual antialiasing). M5-8 ✅ **RELEASED em `@theokit/sdk@2.4.0`** (npm, 2026-06-22 — `@theokit/sdk/models`: parseModelId público + humanizeModelName + toModelOption). M5-1 + M5-2 ✅ **RELEASED em `theokit@0.7.0`** (npm `latest`, 2026-06-22 — `theokit/client`: `liveText`/`error` em `useAgentStream` + `foldAgentToolCards`/`useAgentToolCards`; commits f0f8270 → 07d7e17; PR #18 merged, tag `theokit@0.7.0`, GitHub release; cascata de peer-dep de http/agents→1.0.0 suprimida, ambos mantidos em 0.5.4/0.4.0). M5-3 ✅ RELEASED `@theokit/ui@0.17.0` (`AgentToolRenderer` registry overridable + classify + fallback ToolCallPart; agora é registry item de 1ª classe com story; commits 3bcd83e → 978d1b2). M5-4 ✅ RELEASED `@theokit/ui@0.17.0` (`@theokit/ui/sdk-tools-adapters` — adapters puros tool-result→props; contract test removido por inviabilidade no CI standalone, 25 unit tests contra os shapes documentados; commits → fdb2cd8). M5-5 ✅ RELEASED `@theokit/ui@0.17.0` (`useStickToBottom` MutationObserver+threshold guard, encapsula seletor Radix; commits → 764f53f). M5-6 ✅ RELEASED `@theokit/ui@0.17.0` (`toAgentStreamItems` order-aware history+live builder; commits → ed26c76). M5-7 ✅ RELEASED `@theokit/ui@0.17.0` (`TokenUsageChart` maxScale/splitSeries + toUsageMetrics/splitUsagePoints; commits → 45348f6). **M5 inteiro RELEASED no npm (2026-06-22): `@theokit/ui@0.17.0` + `@theokit/sdk@2.4.0` + `theokit@0.7.0`.**

| ID | Gap | Repo · Package | Sev | Esf | Depende de | Ação |
|---|---|---|---|---|---|---|
| M5-1 ✅ (RELEASED `theokit@0.7.0`) | `liveText` + `error` derivados no hook | fw · theokit/client | med | S | M1-5 | `deriveLiveText`/`deriveError` + campos em `UseAgentStreamReturn`. |
| M5-2 ✅ (RELEASED `theokit@0.7.0`) | Fold de AgentEvent → tool cards | fw · theokit/client | high | M | M1-5 | `foldAgentToolCards(events)` + `useAgentToolCards()` correlacionando call→result por id (FIFO-by-name fallback); resolver de envelope injetável. |
| M5-3 ✅ (RELEASED `@theokit/ui@0.17.0`) | `AgentToolRenderer` (despacho tool→componente rico) | ui · @theokit/ui | high | L | M3 (shapes) | Registry overridable por kind (Diff/Terminal/Code/CreatedFiles/DataTable) + classifyTool + fallback ToolCallPart; renderers ricos só em state output-available. Adapters fiéis = M5-4. |
| M5-4 ✅ (RELEASED `@theokit/ui@0.17.0`) | Adapters tool-result→props UI | ui · @theokit/ui | high | M | M3 (shapes) | Subpath `@theokit/ui/sdk-tools-adapters` (adapters puros git_diff/read_file/shell/list_dir/apply_patch + parseUnifiedDiff; zero runtime dep) + contract test importando as factories reais (dev-only file: link). |
| M5-5 ✅ (RELEASED `@theokit/ui@0.17.0`) | Auto-scroll stick-to-bottom | ui · @theokit/ui | high | M | — | `useStickToBottom` (MutationObserver p/ crescimento + ResizeObserver p/ tamanho + threshold guard); encapsula o seletor Radix vazado; pure `isNearBottom`. |
| M5-6 ✅ (RELEASED `@theokit/ui@0.17.0`) | Montagem de `AgentStreamItem[]` (history+live) | ui · @theokit/ui | med | M | M5-2 | `toAgentStreamItems({history,live},{classifyTool})` order-aware puro; history→message, live AgentEvent→tool-call. |
| M5-7 ✅ (RELEASED `@theokit/ui@0.17.0`) | `splitUsagePoints`/`toUsageMetrics` + props no chart | ui · @theokit/ui | low | S | — | Props `splitSeries`/`maxScale` (clamp proporcional no stacked) no `TokenUsageChart` + helpers puros. |
| M5-8 ✅ (RELEASED `@theokit/sdk@2.4.0`) | `toModelOption` (humanizar slug OpenRouter) | sdk · @theokit/sdk | low | S | M2-4 | `parseModelId` público + `humanizeModelName`. |

**Concluído quando:** o showcase e o template do `create-theokit` deletam seus helpers à mão e importam do framework.

---

## M6 — Eval harness (Tema E)

> **Status: RELEASED (5/5)** — código em `main` via tag repo-wide `v3.3.0` (2026-06-22, PR #30 merged). npm `@theokit/sdk@2.5.0` (changeset minor) via Version Packages PR pós-merge. Plan `m6-eval-harness` SHIPPABLE_WITH_CAVEATS 70.0, blueprint 89.0, review READY_TO_MERGE; suíte 2860 verde, zero deps novas. Tema E completo.

**Valor entregue:** transforma "agente editou um repo" em "aqui está o patch e ele aplica/passa". Runs SWE-bench são multi-hora e $-heavy; sem resume/flush todo consumidor sério reconstrói crash-durability.

| ID | Gap | Repo · Package | Sev | Esf | Depende de | Ação |
|---|---|---|---|---|---|---|
| M6-1 ✅ | Runner batch resiliente (resume + flush JSONL) | sdk · @theokit/sdk eval | high | L | M1-2 | `appendJsonl`/`readJsonlIds` + `Eval.run` com `{persist:{path,key,resume}}` + flush por linha + `classify()`. |
| M6-2 ✅ | Verify-gate scorer (exit code) | sdk · eval+sandbox | med | M | — | `Scorers.verifyGate({failToPass,passToPass})` via `SandboxBackend.execute`; `EvalRowResult.artifact{diff,applies}`. |
| M6-3 ✅ | `RepoProvisioner` (clone+checkout isolado) | sdk · sandbox | low | M | — | `provisionRepo(sandbox,{repoUrl,ref,instanceId})` portável Local/Docker/E2B; `RepoProvisionError`. |
| M6-4 ✅ | Headless code-runner (git diff + patch validate) | sdk · sdk+sdk-tools | med | M | M1-2 | Diff + validação de patch como artefato gradeável. |
| M6-5 ✅ | `loadJsonl` (loader dataset genérico) | sdk · eval | low | S | — | `loadJsonl(path,{map})` com erro tipado por nº de linha; schema SWE-bench fica no app via `map`. |

**Concluído quando:** uma run SWE-bench cai e resume sem perder trabalho; scoring é por exit-code, não heurística de texto.

---

## M7 — HTTP, persistência e consolidação dual-surface (Tema F)

> **Status: RELEASED (3/3 slices) — 2026-06-22.** npm: `theokit@0.8.0`, `@theokit/sdk@2.5.0`, `@theokit/sdk-budget@0.3.0`, `@theokit/orm@0.1.0` (first stable, dropped -next). Published manually via token; per-package tags pushed. cycle discover→plan→implement→review completo nos 3 repos: **theokit** M7-1/2/3 (typed errors/404 no defineRoute + defineHealthRoute/Ready + theokit/boot; review READY_TO_MERGE, commits de77073…717bc06); **theokit-sdk** M7-4/5/6 (PermissionEngine defaultAction + createPermissionPlugin + formatCostUsd honest-null; review READY_TO_MERGE, 32180fe/dd0a334); **@theokit/orm** M7-7 (createRepository non-DI factory; review READY_TO_MERGE, c957088/e2a7d49). Zero deps novas; nenhum pacote depende do principal theokit. Follow-ups documentados: variante sync better-sqlite3 do orm + instalar @theokit/orm no theocode. Merged: theokit PR #20 + theokit-sdk PR #31; @theokit/orm M7-7 via main (branch criada de develop).

**Valor entregue:** resolve a tensão das duas superfícies HTTP paralelas (convention dev-server vs imperative TheoApp) que não compartilham primitivos. Quase independente — pode ir na onda 1.

| ID | Gap | Repo · Package | Sev | Esf | Depende de | Ação |
|---|---|---|---|---|---|---|
| M7-1 ✅ | 404 / typed exception em `defineRoute` | fw · theokit | med | M | — | Exportar `TheoError`+`fromUnknown`+sugar via `theokit/server`; rotear catch legado por `serverErrorToEnvelope`. |
| M7-2 ✅ | Health-check route p/ filesystem-route server | fw · theokit | low | S | — | `defineHealthRoute`/`defineReadyRoute` (orquestrador já default-polla `/health`). |
| M7-3 ✅ | Boot programático do server | fw · theokit | low | S | — | Promover `startDevServer`/`startCommand` a `theokit/boot`. |
| M7-4 ✅ | `default-deny` no PermissionEngine | sdk · @theokit/sdk | low | S | — | `defaultAction: PermissionAction` (default `"allow"`); 1 linha, backward-compatible. |
| M7-5 ✅ | PermissionEngine+definePlugin wiring (exemplar) | sdk · @theokit/sdk | low | S | M7-4 ✅ | Documentar o wiring como exemplo; só falta default-deny. |
| M7-6 ✅ | Per-mode tool permission + projeção de usage/cost | sdk · server/cost+sdk | low | M | M1-6 | `UsageRecord.costUsd` nullable + `UsageResult.costKnown`; CostMeter renderiza `—`. |
| M7-7 ✅ | Drizzle Repository CRUD (async-only + DI-first são as barreiras) | di · @theokit/orm | med | M | — | `createRepository(db,table)` non-DI + variante sync-aware p/ better-sqlite3; instalar @theokit/orm no theocode. |

**Concluído quando:** um builder não precisa escolher entre "convention sem health/logRequest tipado" e "TheoApp que não serve as rotas do `theokit dev`".

---

## M8 — Camada declarativa: dar runtime aos decorators (Seção 6)

**Valor entregue:** elimina o anti-padrão "decorator sem runtime". Cada decorator passa a compilar para uma chamada real aos primitivos das ondas 1–3. Resolve a tensão estratégica imperativo-vs-declarativo.

| ID | Gap | Repo · Package | Sev | Esf | Depende de | Ação |
|---|---|---|---|---|---|---|
| M8-1 | `@ContextWindow` / `AutoSummarize` sem runtime | sdk · @theokit/sdk · agents | med | M | M2-1, M2-2 | Compilar metadata para chamadas a `compactTranscript`/`shouldCompact`. |
| M8-2 | `@ProjectContext` sem executor | sdk · @theokit/agents | med | M | M3-3, M4-2 | `getProjectContextConfig` passa a dirigir `buildRepoMap`/`readProjectInstructions`. |
| M8-3 | `@Skills` sem runtime | sdk · @theokit/agents | med | S | M4-1 | Decorator dirige `discoverSkills`/`buildSkillsBlock`. |
| M8-4 | Decisão estratégica di/gateways/plugins | — · investigação | — | M | M1–M5 | Avaliar alinhamento: o on-ramp imperativo (o que se usa) precisa das peças que esses pacotes não preenchem. Documentar em ADR. |

**Concluído quando:** nenhum decorator é metadata-only; existe ADR decidindo o futuro de di/gateways à luz do uso real (imperativo, local-first).

---

## Cobertura — os 52 gaps mapeados

Prova de completude: cada gap confirmado da tabela mestra do relatório → milestone.

| # | Gap (título do relatório) | Milestone |
|---|---|---|
| 1 | budgetTracker.nextIteration() morto | M1-1 |
| 2 | Tool scoping por sub-agente sem enforcement | M4-6 |
| 3 | safeFilenameForId (4 respostas divergentes) | M0-4 |
| 4 | Token estimate + shouldCompact | M2-2 |
| 5 | default-deny no PermissionEngine | M7-4 ✅ |
| 6 | Health-check route | M7-2 ✅ |
| 7 | Boot programático do server | M7-3 ✅ |
| 8 | 404 typed exception em defineRoute | M7-1 ✅ |
| 9 | AgentToolRenderer | M5-3 |
| 10 | Auto-scroll stick-to-bottom | M5-5 |
| 11 | accumulateAssistantText + streamError | M5-1 |
| 12 | Fold de AgentEvent → tool cards | M5-2 |
| 13 | mapWithConcurrency (pool bounded) | M0-2 |
| 14 | withRetry genérico | M0-3 |
| 15 | isTransientError | M0-1 |
| 16 | Loop de continuação sobre teto de 8 passos | M1-2 |
| 17 | Compaction (summarize→checkpoint→keep-recent) | M2-1 |
| 18 | Reflection ladder corretiva bounded | M1-4 |
| 19 | Erro tipado de context-overflow | M2-3 |
| 20 | Continuation-history (event→replayable) | M1-3 |
| 21 | Agregação de usage multi-round (honest-null) | M1-6 |
| 22 | Headless code-runner | M6-4 |
| 23 | Discovery de skills em dir arbitrário + `<skills>` | M4-1 |
| 24 | Memory taxonomia tipada | M4-3 |
| 25 | Plan-mode artifact persistence | M4-4 |
| 26 | SSRF guard p/ web_fetch | M3-1 |
| 27 | Screen de shell catastrófico | M3-2 |
| 28 | Rich errors (self-correction) | M3-4 |
| 29 | ACI description override + `<tools>` | M3-5 |
| 30 | Per-mode tool permission + cost projection | M7-6 ✅ |
| 31 | Repo-map / env-context builder | M3-3 |
| 32 | Reader/writer de project-instructions | M4-2 |
| 33 | Catastrophic shell (perm.plugin path) | M3-6 |
| 34 | Stream-message → wire-event mapper | M1-5 |
| 35 | Catálogo per-model context-window | M2-4 |
| 36 | Drizzle Repository CRUD | M7-7 ✅ |
| 37 | SQLite bootstrap (WAL+FK) | M0-5 |
| 38 | Eval seed→agent→verify-gate | M6-2 |
| 39 | RepoProvisioner | M6-3 |
| 40 | Runner batch resiliente (resume + flush) | M6-1 |
| 41 | Adapters tool-result→props UI | M5-4 |
| 42 | Montagem de AgentStreamItem[] | M5-6 |
| 43 | splitUsagePoints / toUsageMetrics | M5-7 |
| 44 | toModelOption (humanizar slug) | M5-8 |
| 45 | toTaskPlanNodes (TodoItem→PlanNode) | M4-5 |
| 46 | Loader dataset JSONL | M6-5 |
| 47 | `<memories>` combinado (doc + facts) | M0-9 |
| 48 | Atomic write reimplementado | M0-6 |
| 49 | Persistência+onboarding OpenRouter key | M0-10 |
| 50 | Migration drizzle-kit (ensureColumn) | M0-7 |
| 51 | Logger middleware reimplementa logRequest | M0-8 |
| 52 | Adapter env-driven de web-search | M3-7 |

> Os dois itens de wiring de baixa severidade (`PermissionEngine+definePlugin wiring`, `catálogo per-model` na ótica sdk-integration) estão absorvidos em M7-5 e M2-4. Total: **52/52 cobertos**.

---

## Resumo por repo (planejamento de release)

| Repo | Itens | Milestones que tocam | Releases sugeridos |
|---|---|---|---|
| theokit-sdk | ~34 | M0,M1,M2,M3,M4,M6,M7,M8 | minor por milestone; M0 pode ser um único minor de "expose internals" |
| theocode (app) | 5 | M0 | patch único de Regra 9 |
| theokit-a (fw) | 5 | M5,M7 | minor (client) + minor (theo) |
| theo-ui | 6 | M5 | minor (com adapters co-versionados a sdk-tools) |
| theokit-di | 1 | M7 | minor (orm non-DI) |

**Acoplamento de release a vigiar:** M5 (UI) só fecha com `@theokit/ui` + `theokit/client` + os shapes de `sdk-tools` (M3) alinhados — co-versionar adapters. M8 depende de primitivos publicados em M2/M3/M4.

---

## Sequência recomendada de arranque

1. **M0 inteiro** — fundação; libera retry/concurrency/transient/path/sqlite e zera a dívida de Regra 9 no theocode.
2. **M1-1** (`nextIteration`) e **M3-1/M3-2** (SSRF + shell) em paralelo — os três HIGH de maior risco/menor esforço.
3. **M1-2** (continuation driver) — o item L que destrava M2, M6 e M8.
4. Onda 3 (M2, M5, M6) conforme M1/M3/M4 fecham.
5. **M8** por último — colhe os primitivos e elimina os decorators-fantasma.
