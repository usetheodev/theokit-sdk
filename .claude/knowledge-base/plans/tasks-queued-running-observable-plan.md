# Plan: Tasks (queued/running observable)

> **Version 1.2** — Adiciona a `@usetheo/sdk` um conceito de **Task** observável: um registry leve de jobs com estados `queued | running | finished | error | cancelled`, API pública (`Task.submit / list / get / cancel / subscribe`), persistência pluggável (in-memory default, JSON disk opt-in). Fecha o segundo gap da análise vs OpenClaw + Hermes Agent (o primeiro foi ACP, shipado em 2026-05-27). Resultado esperado: usuário consegue submeter trabalho assíncrono via `Task.submit("kind", workFn)`, listar todas as tasks ativas/históricas, cancelar individualmente, e consumir um stream de eventos de progresso — exatamente como Hermes oferece via kanban SQLite, mas sem o overhead de SQLite no caminho default.
>
> **v1.1 changelog** — Absorveu 7 MUST FIX + 6 SHOULD TEST + 3 DOCUMENT do edge-case review (EC-1..EC-16). Adições principais: auto-mkdir do JsonFileTaskStore, validação de ID grammar defense-in-depth no store, wrap sync throws, abort-no-submit short-circuit, prefixo namespaced de taskId nos adapters (`wf-`/`b-`/`cron-`), ENOENT-as-empty no list, e flag `cancelRequested` para cross-process best-effort cancel via CLI.
>
> **v1.3 status update (Phase 3.2-3.5 adapters)** — 3 dos 4 adapters integrados shipados:
>
> - ✅ **T3.2 `Agent.send({ task })`** — `LocalAgent.send` registra a Run no registry quando `options.task` é truthy; cancel via `Task.cancel(id)` propaga pra `run.cancel()` via AbortController. CloudAgent rejeita com `UnsupportedTaskOperationError` (D370). 4 tests em `tests/integration/send-with-task.test.ts`.
> - ✅ **T3.3 `Agent.batch({ task })`** — registra o batch inteiro como 1 task `kind: "batch"` com prefixo `b-`. v1 emite parent only (per-prompt children diferidos pra v0.2). 4 tests em `tests/integration/batch-with-task.test.ts`.
> - ✅ **T3.4 `Workflow.run({ task })`** — registra como `kind: "workflow"` com prefixo `wf-{runId}`. 4 tests em `tests/integration/workflow-with-task.test.ts`.
> - ⏳ **T3.5 `Cron` task fires** — DIFERIDO para v0.2. Requer hookar no dispatcher do croner pra registrar cada fire como Task individual; mais invasivo que os outros 3. Pattern user-side continua funcionando (cron handler chama `Task.submit("cron", ...)` internamente).
>
> Esse delta: (a) preserva 100% da backward-compat (default behavior absolutely unchanged); (b) entrega os 3 adapters de maior leverage; (c) deixa porta aberta pra cron adapter em v0.2 com dispatcher hook. Integration tests `task-user-side-wrap.test.ts` continuam cobrindo o pattern user-side pra qualquer runtime async (incluindo cron handlers).

## Context

### O que existe hoje

- `Run` é transient — vive em memória durante uma `agent.send`, descartada após `wait()`. Sem ID externamente queryable, sem registry.
- `Agent.batch(prompts, opts)` (ADRs D134-D140) retorna `Promise<Result[]>`. Não há observabilidade mid-flight; o caller espera o array inteiro.
- `Workflow.run` (ADRs D230-D248) tem `runId` + `WorkflowSnapshotStore` para suspend/resume, mas o store é privado do executor — não há API pública pra listar runs em voo.
- `Cron` (ADRs D7-D8) agenda jobs via `croner`, mas cada fire é fire-and-forget — sem histórico de execuções nem cancel granular.
- `Run.fork()` (ADRs D110-D114) é ephemeral, descartado após uso.

### Evidência do gap

**Auditoria das 5 referências em `referencia/` (2026-05-27):**

| Ref | Tem task registry? | Estados | Persistência | API pública de list/cancel |
|---|---|---|---|---|
| **hermes-agent** | ✅ SQLite `tasks` + `task_events` | 7 (triage→archived) | SQLite WAL + CAS lock | `list_tasks(filter)` + `archive_task()` (CAS) |
| **mastra** | ⚠ Pluggable storage para workflow runs | implícito (success/error) | DuckDB/SQLite via `getStore('workflows')` | `subscribe()` via realtime + poll |
| **openai-agents-python** | ❌ RunState snapshots, sem registry | snapshot é opaque | JSON serialize opt-in caller | — (HITL pause/resume only) |
| **openclaw** | ❌ Fire-and-forget cron | — | — | — |
| **pi** | ❌ JSONL session log per cwd | append-only events | JSONL file | — |

Hermes é a única referência madura com task registry observável global. Adotamos o **modelo Hermes simplificado** (5 estados ao invés de 7, sem kanban semantics) + **storage pluggable estilo Mastra** (memory default, JSON disk opt-in, SQLite cross-process diferido pra v0.2). Cancel propagation via AsyncLocalStorage + AbortController (mesmo padrão de D131 credential pool, D111 fork whitelist).

### Por que NOW

1. ACP shipou — agora um cliente Zed externo pode submeter trabalho via `session/prompt`, mas não tem como inspecionar tasks em voo (apenas o stream do próprio prompt).
2. `Agent.batch` virou popular pra evaluação massiva (ADR D204 Eval consume batch); sem progress observability o usuário fica no escuro até o array terminar.
3. Workflows com `suspend/resume` não têm forma do operador humano listar quais runs estão pausados aguardando resume.
4. Cron jobs disparam silenciosamente; quando falham, não há audit trail.

## Objective

**Done = caller pode submeter qualquer trabalho assíncrono da SDK e (a) receber `taskId`, (b) listar/inspecionar todas as tasks via `Task.list()`, (c) cancelar qualquer uma idempotentemente, (d) consumir progresso via `Task.subscribe(taskId)`, (e) opcionalmente persistir cross-restart via JSON store, sem quebrar o caller API existente de `Run`/`Batch`/`Workflow`/`Cron`.**

Goals:

1. `Task.submit / list / get / cancel / subscribe` públicos no namespace `Task` (mirror do `Cron`).
2. Registry in-process default + JSON disk store opt-in (`Task.configure({ store: { backend: "json", dir: ... } })`).
3. `Run`, `Batch.run` (novo), `Workflow.run`, `Cron` fire — todos auto-registram Task transparentemente.
4. 5 estados closed enum: `queued | running | finished | error | cancelled`.
5. `Task.cancel(id)` é idempotente, propaga via AbortController atrás de AsyncLocalStorage.
6. `Task.subscribe(id)` retorna AsyncIterable com **replay buffer** (last N events) pra handle late attach.
7. Telemetry: 3 OTel spans (`task.submit`, `task.transition`, `task.cancel`).
8. Zero breaking changes na API atual — `agent.send(prompt)` continua igual; `agent.send(prompt, { task: true })` opt-in para receber taskId.
9. Cobertura ≥90% no novo módulo + dogfood telegram-pro `/tasks list/cancel` validando real-LLM.
10. ADRs D361-D374 commitados antes da merge.

## ADRs

| ID | Decisão | Rationale | Consequência |
|---|---|---|---|
| **D361** | `Task` é static class com private constructor; namespace público `Task` (`Task.submit/list/get/cancel/subscribe`) | Mirror do `Agent`, `Cron`, `Eval`, `Workflow` — consistência da API surface da SDK | Caller usa `import { Task } from "@usetheo/sdk"`; não precisa instanciar |
| **D362** | 5 estados closed enum: `queued \| running \| finished \| error \| cancelled` (NÃO Hermes's 7) | Hermes's 7 (triage/todo/ready/running/blocked/done/archived) carrega kanban semantics que não pertencem à SDK (são UI concerns). 5 estados cobrem 100% do lifecycle de qualquer Run/Batch/Workflow/Cron-fire | `triage/blocked/archived` não existem; usuário que precisa de kanban constrói por cima |
| **D363** | Wrapping é OPT-IN via `{ task: true }` ou `{ taskId: "auto" }` — `agent.send(prompt)` sem opção segue 100% backward compatible | Backward compat absoluto (mesma régua de D108 v1.2 caller API preserved). Caller que não quer overhead de registry não paga | Default behaviour permanece transient. Quem quer observabilidade pede explicitamente |
| **D364** | `TaskStore` é interface pluggável: `InMemoryTaskStore` (default) + `JsonFileTaskStore` (opt-in). SQLite cross-process diferido pra v0.2 | Espelha exatamente o padrão de `WorkflowSnapshotStore` (D235) — mesma curva de aprendizado pro usuário. SQLite traz nova dep peer + cross-process locking (custo alto pra valor incerto em v1) | v1 não cobre tasks visíveis entre múltiplos processos Node; v0.2 pode adicionar SQLite |
| **D365** | Cancel é **idempotente** + propaga via `AbortController` armazenado por TaskRegistry; cancel de `queued` task = mover direto pra `cancelled` sem invocar runtime | Idempotência reduz race conditions (caller pode chamar cancel 2x sem erro). Cancelar queued antes de start economiza recursos | `Task.cancel(id)` nunca throws; retorna `{ cancelled: true \| false, alreadyTerminal: boolean }` |
| **D366** | `TaskEvent` é discriminated union por `type` (`submitted`, `started`, `progress`, `finished`, `errored`, `cancelled`) | Mesmo padrão de `GoalEvent` (D115) e `SDKMessage`. Exhaustive `switch` com `as never` compile-time check evita drift | Adicionar novo tipo de event vira breaking change visível no compilador |
| **D367** | Single-flight por `taskId` — submeter task com ID duplicado retorna o existente (não cria novo nem throws) | Idempotência pra retries no caller side (ex: HTTP handler que recebe webhook duplicado). Mesmo padrão de D213 `Eval.run` single-flight per name | `Task.submit({ id: "x" })` chamado 2x retorna mesmo registry entry — caller deve gerar IDs únicos quando quer fan-out |
| **D368** | Task IDs: user-provided ou auto via `crypto.randomUUID()`; quando user-provided, grammar `^[a-z0-9][a-z0-9_-]*$` + prefixos reservados `wf-`, `b-`, `cron-` (EC-5 namespace) | Reusa D239 (workflow step IDs) e D81 (sanitizeIdentifier). Strict grammar evita injection em JSON store paths. Prefixos reservados garantem que adapter-generated IDs (workflow/batch/cron) nunca colidem com user-supplied | Caller que passa ID inválido OU com prefixo reservado recebe `InvalidTaskIdError`; auto-gen sempre seguro |
| **D369** | Concorrência throttled via `AsyncSemaphore` (default 8) — reusa D135 in-house primitive | D135 já está auditado + 1600 fast-check runs verde. Não trazemos `p-limit`/`p-queue` (mesma decisão que Batch) | Default 8 é override via `Task.configure({ maxConcurrent: N })` |
| **D370** | `CloudAgent` task ops throw `UnsupportedRunOperationError` em v1 (cloud runtime continua pre-release) | Mesma régua de D122 (runUntil), D169 (personality), D244 (workflow), D296 (Bedrock Converse). Registry é local-only por enquanto | Cloud usage tenta task = erro tipado; v1.x estende quando PaaS GA |
| **D371** | Telemetry via OTel seam existente: 3 spans (`task.submit`, `task.transition state→state`, `task.cancel`) | Reusa Telemetry (D34) + observability seam de Workflow (D241), Cache (D262). Sem novo tracer | Adapters Langfuse/Sentry/PostHog (D42) recebem spans sem configuração extra |
| **D372** | `Task.subscribe(id)` retorna AsyncIterable com **replay buffer** dos últimos `replayCap = 64` events; late-attach recebe replay antes de live tail | Tasks rápidas (cron tick) podem completar antes do subscriber assinar. Buffer evita race: subscriber pega tudo desde submit. Cap em 64 events evita memory leak em tasks long-running | Subscribe muito tardio em tasks com >64 events recebe só os últimos 64 + flag `truncated: true` no primeiro yield |
| **D373** | Auto-eviction de tasks `terminal` (finished/error/cancelled) após `retentionMs = 1h` no InMemoryStore; JsonFileStore default `7d` | Sem eviction o registry vira memory leak. 1h em memória cobre debugging interativo; 7d em disco cobre operações multi-day | Caller que precisa de retention maior reconfigura via `Task.configure({ retentionMs })` |
| **D374** | Cron + Batch + Workflow integration são **adapters thin** que chamam `Task.submit` internamente quando wrapping é solicitado — NÃO reimplementam registry | Composes-over-replaces (D246 workflow pattern). Mantém Task como single source of truth | Adicionar novo runtime async (futuro `Eval.run`) pluga via mesmo padrão sem mexer no core |

## Dependency Graph

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 4
(ADRs)      (types)    (store)     (registry)   (wrapping
                                                  Run/Batch/
                                                  Workflow/Cron)
                                       │
                                       ▼
                                  Phase 5 (parallel after 4)
                                  (telemetry + cancel propagation)
                                       │
                                       ▼
                                  Phase 6 (CLI verb)
                                       │
                                       ▼
                                  Phase 7 (docs + example + dogfood)
```

Phases 0-4 sequential blockers. Phase 5 pode rodar paralelo a 6 após 4 landar. Phase 7 é o gate final.

---

## Phase 0: Inventory + ADRs

**Objective:** Lock the 14 ADRs (D361-D374) com rationale documentado antes de escrever código.

### T0.1 — Commit ADRs D361-D374

#### Objective
Materialize as 14 decisões da tabela ADRs acima em arquivos individuais em `.claude/knowledge-base/adrs/`.

#### Evidence
Padrão do repo: planos com 10+ ADRs (ACP D349-D360, Workflows D230-D248, Batch D134-D140) sempre commit ADR files antes de Phase 1.

#### Files to edit
```
.claude/knowledge-base/adrs/D361-task-static-class.md (NEW)
.claude/knowledge-base/adrs/D362-task-five-state-enum.md (NEW)
.claude/knowledge-base/adrs/D363-task-wrapping-opt-in.md (NEW)
.claude/knowledge-base/adrs/D364-task-store-pluggable.md (NEW)
.claude/knowledge-base/adrs/D365-task-cancel-idempotent.md (NEW)
.claude/knowledge-base/adrs/D366-task-event-discriminated-union.md (NEW)
.claude/knowledge-base/adrs/D367-task-single-flight-per-id.md (NEW)
.claude/knowledge-base/adrs/D368-task-id-grammar.md (NEW)
.claude/knowledge-base/adrs/D369-task-async-semaphore-reuse.md (NEW)
.claude/knowledge-base/adrs/D370-task-cloud-unsupported.md (NEW)
.claude/knowledge-base/adrs/D371-task-telemetry-spans.md (NEW)
.claude/knowledge-base/adrs/D372-task-subscribe-replay-buffer.md (NEW)
.claude/knowledge-base/adrs/D373-task-auto-eviction-retention.md (NEW)
.claude/knowledge-base/adrs/D374-task-runtime-adapters-thin.md (NEW)
```

#### Deep file dependency analysis
ADRs são free-standing markdown sem dependências de código. Cada arquivo segue template existente (Decision / Rationale / Consequences). Downstream: CLAUDE.md tabela ADR é atualizada na finalização (Phase 7) com referência aos 14 novos IDs.

#### Deep Dives
- **Idempotência** (D365 + D367): cancel chamado 2x em task `queued` → segundo retorna `alreadyTerminal: true`. Submit chamado 2x com mesmo ID → segundo retorna mesma `TaskHandle`.
- **Late-attach replay buffer** (D372): registry mantém `ring buffer<TaskEvent>` cap 64 por task. Subscribe assina o ring + drena buffer antes de live tail. Quando event count > 64 dropa head, e marca `truncated: true` no próximo yield.

#### Tasks
1. Criar os 14 arquivos ADR seguindo o formato dos D349-D360.
2. Atualizar `CLAUDE.md` tabela ADRs com 14 linhas novas (no final do bloco existente).
3. Commit `docs(adr): D361-D374 — Tasks observable registry` antes de Phase 1.

#### TDD
```
N/A — ADRs são docs-only. TDD começa em Phase 1.
```

#### Acceptance Criteria
- [ ] 14 arquivos ADR existem em `.claude/knowledge-base/adrs/` com nomenclatura `D{N}-{kebab-slug}.md`
- [ ] Cada ADR tem seções Decision / Rationale / Consequences
- [ ] `CLAUDE.md` tabela ADR atualizada com referência aos 14 IDs
- [ ] Commit isolado `docs(adr): D361-D374`

#### DoD
- [ ] `git log --oneline -1` mostra commit de ADRs
- [ ] `grep -c "^| D36[1-9]\\|^| D37[0-4]" CLAUDE.md` retorna 14

---

## Phase 1: Core types (TaskState, TaskEvent, TaskHandle)

**Objective:** Materializar os tipos públicos que vão pro `index.ts` da SDK.

### T1.1 — Definir tipos em `packages/sdk/src/types/task.ts`

#### Objective
Single source de tipos públicos referenciados por todos os módulos task-aware.

#### Evidence
Pattern do repo: `packages/sdk/src/types/{agent,run,workflow,cron,eval,cache}.ts` — cada feature tem um `types/{feature}.ts` que exporta os tipos públicos consumidos pelo barrel `index.ts`.

#### Files to edit
```
packages/sdk/src/types/task.ts (NEW) — 5-state enum, TaskKind, TaskEvent union, TaskHandle, TaskFilter, TaskSubmitOptions, TaskStore interface (forward decl)
packages/sdk/src/index.ts — barrel re-export dos tipos públicos (Task namespace ainda não, só types)
packages/sdk/src/errors.ts — adicionar InvalidTaskIdError, TaskNotFoundError, UnsupportedTaskOperationError (cloud)
```

#### Deep file dependency analysis
- `types/task.ts` — novo, zero downstream deps inicial (será consumido por phases 2+).
- `index.ts` — barrel já re-exporta tipos de workflow/cron/eval; adicionar Task types no mesmo bloco.
- `errors.ts` — atual tem 30+ error classes; nova adição segue o mesmo padrão `extends TheokitAgentError`. ADR D65/D66 governam `ErrorMetadata` + `ErrorCode` literal union — adicionar `"invalid_task_id" | "task_not_found" | "task_op_unsupported"` ao union existente.

#### Deep Dives

**TaskState (closed enum):**
```ts
export type TaskState = "queued" | "running" | "finished" | "error" | "cancelled";
```

**TaskKind (closed enum) — discriminator do underlying runtime:**
```ts
export type TaskKind = "run" | "batch" | "workflow" | "cron" | "custom";
```

**TaskEvent (discriminated union por `type`):**
```ts
export type TaskEvent =
  | { type: "submitted"; taskId: string; kind: TaskKind; submittedAt: number; meta?: Record<string, unknown> }
  | { type: "started"; taskId: string; startedAt: number }
  | { type: "progress"; taskId: string; at: number; payload: unknown }
  | { type: "finished"; taskId: string; finishedAt: number; result: unknown }
  | { type: "errored"; taskId: string; erroredAt: number; error: { code: string; message: string } }
  | { type: "cancelled"; taskId: string; cancelledAt: number; reason?: string };
```

**TaskHandle (public read-only view):**
```ts
export interface TaskHandle {
  readonly id: string;
  readonly kind: TaskKind;
  readonly state: TaskState;
  readonly submittedAt: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly cancelledAt?: number;
  readonly erroredAt?: number;
  readonly result?: unknown;
  readonly error?: { code: string; message: string };
  readonly meta?: Record<string, unknown>;
  /**
   * EC-7 — cross-process best-effort cancel flag. Set by CLI `theokit tasks cancel`
   * via JsonFileTaskStore. The owning process polls at checkpoints and honors via
   * AbortController. Always `undefined` for in-process cancel paths (which go
   * directly through AbortController).
   */
  readonly cancelRequested?: boolean;
}
```

**TaskFilter (query API):**
```ts
export interface TaskFilter {
  state?: TaskState | TaskState[];
  kind?: TaskKind | TaskKind[];
  submittedAfter?: number;
  submittedBefore?: number;
  limit?: number;  // default 100
}
```

**TaskSubmitOptions:**
```ts
export interface TaskSubmitOptions {
  id?: string;           // user-provided ID; grammar D368
  meta?: Record<string, unknown>;
  signal?: AbortSignal;  // external abort hook
}
```

**Invariantes:**
- `state` transitions são acyclic: queued → running → (finished | error | cancelled). Cancelled é terminal de queued OU running.
- `startedAt`/`finishedAt`/etc são timestamps (epoch ms).
- `meta` é arbitrary user payload — never inspected pelo registry.
- `cancelRequested` é write-only do CLI (cross-process); registry só lê.
- IDs adapter-generated têm prefixo reservado (`wf-`/`b-`/`cron-`); user-submitted com esses prefixos → `InvalidTaskIdError` (EC-5).

#### Tasks
1. Criar `packages/sdk/src/types/task.ts` com os 6 tipos públicos.
2. Adicionar 3 error classes em `packages/sdk/src/errors.ts`.
3. Re-exportar do `packages/sdk/src/index.ts` (apenas types, sem `Task` namespace ainda).
4. `pnpm -F @usetheo/sdk run typecheck` verde.

#### TDD
```
RED:     test_task_state_includes_5_values() — TypeScript exhaustive check via `satisfies` operator
RED:     test_task_event_discriminated_union() — exhaustive switch com `as never` no default
RED:     test_invalid_task_id_error_has_metadata() — error.code === "invalid_task_id"
RED:     test_task_handle_optional_cancelRequested_field() — EC-7 shape
RED:     test_validate_task_id_rejects_reserved_prefix_wf_b_cron() — EC-5
GREEN:   Implementar types em task.ts + 3 errors em errors.ts + validator de id grammar
REFACTOR: None expected
VERIFY:  pnpm -F @usetheo/sdk run typecheck && pnpm -F @usetheo/sdk exec vitest run tests/types/task.test.ts
```

#### Acceptance Criteria
- [ ] `import { TaskState, TaskEvent, TaskHandle, TaskFilter, TaskSubmitOptions, TaskKind } from "@usetheo/sdk"` resolve em consumer test
- [ ] Exhaustive switch em `TaskEvent.type` compila com `as never` no default arm
- [ ] 3 error classes extend `TheokitAgentError` com `code` literal correto
- [ ] Pass: complexity check (todos files ≤ 10)
- [ ] Pass: size check (task.ts ≤ 200 lines)

#### DoD
- [ ] `pnpm -F @usetheo/sdk run typecheck` exit 0
- [ ] `pnpm -F @usetheo/sdk exec vitest run tests/types/task.test.ts` 3+ tests passing
- [ ] biome zero warnings

---

## Phase 2: TaskStore abstraction (InMemory + JsonFile)

**Objective:** Implementar a interface `TaskStore` + 2 implementações default seguindo o padrão `WorkflowSnapshotStore`.

### T2.1 — Interface + InMemoryTaskStore + JsonFileTaskStore

#### Objective
Camada de persistência pluggável sem amarrar o caller a uma escolha.

#### Evidence
`packages/sdk/src/internal/workflow/snapshot-store.ts` já implementa o mesmo padrão pra workflow snapshots. Reproduzir a forma de api (`getSnapshotStoreFor(options)`) garante consistência + curva de aprendizado zero.

#### Files to edit
```
packages/sdk/src/internal/task/store.ts (NEW) — interface TaskStore + InMemoryTaskStore + JsonFileTaskStore + factory getTaskStoreFor()
packages/sdk/src/internal/task/store.test.ts (NEW) — unit tests
packages/sdk/src/types/task.ts — adicionar TaskStoreOptions ao module
```

#### Deep file dependency analysis
- `internal/task/store.ts` é novo; nenhum downstream ainda. Será consumido pela TaskRegistry em Phase 3.
- Reusa `safePathJoin` (D80) + `createExclusive` (D82) + atomic write helpers em `internal/persistence/` quando JsonFile.
- Reusa `casUpdate` (D83) — compare-and-swap pra optimistic concurrency em JsonFile.

#### Deep Dives

**Interface:**
```ts
export interface TaskStore {
  insert(handle: TaskHandle): Promise<void>;
  update(id: string, mutation: (h: TaskHandle) => TaskHandle): Promise<TaskHandle | undefined>;
  get(id: string): Promise<TaskHandle | undefined>;
  list(filter: TaskFilter): Promise<TaskHandle[]>;
  delete(id: string): Promise<boolean>;
  evictTerminalOlderThan(epochMs: number): Promise<number>;  // returns count evicted
}
```

**InMemoryTaskStore** — `Map<string, TaskHandle>` + WeakRef pro AbortController. Não persiste; reset on process exit.

**JsonFileTaskStore** — diretório `${THEOKIT_HOME}/tasks/`, 1 arquivo por task (`{id}.json`). Atomic write via O_EXCL temp file + rename. List() faz scandir + parse paralelo (`Promise.all`) com cap em 256 tasks loaded de uma vez (rest fica disco-only).

**EC-1 (MUST FIX):** Construtor faz `fs.mkdirSync(dir, { recursive: true })` (idempotente, swallow EEXIST). Garante que primeira submit nunca falha em ENOENT.

**EC-2 (MUST FIX, security defense-in-depth):** Cada método de I/O (`insert/update/get/delete`) re-valida `id` contra a regex de D368 antes de qualquer path operation. Throws `InvalidTaskIdError` se inválido — mesmo que o caller pule a camada do registry (`store.insert` direto), path traversal fica bloqueada.

**EC-6 (MUST FIX):** `list()` catch ENOENT no scandir → retorna `[]`. CLI `tasks list` no fresh install não quebra com diretório inexistente.

**EC-8 (SHOULD TEST):** `list()` scandir ignora arquivos `.tmp.*` (órfãos de atomic write interrompido) ao invés de tentar parsear.

**EC-14 (DOCUMENT):** JSDoc de `list()` documenta cap 256; paginação via `filter.submittedBefore` repetidamente.

**EC-15 (DOCUMENT):** JSDoc da classe `JsonFileTaskStore` documenta: "single-process only; concurrent writers em diferentes processos podem corromper o store. Para cross-process, aguardar v0.2 com SQLite + D61 file lock."

**Eviction** — `evictTerminalOlderThan(epochMs)` percorre o registry, remove tasks `finished | error | cancelled` cujo `finishedAt < epochMs`. Default trigger: timer interno na TaskRegistry a cada 5min (Phase 3).

**Edge cases:**
- JsonFile com `THEOKIT_HOME` env undefined → fallback `path.join(cwd, ".theokit", "tasks")` (D60 pattern).
- Corrupt JSON file no scandir → log stderr + skip + return undefined (não throw — degrade graciosamente, mesma régua de D50/EC-7 cache).
- ENOENT em `list()` scandir (dir nunca foi criado pra esse processo) → return `[]` silenciosamente (EC-6).
- Concorrência: 2 processos escrevendo no mesmo JsonFile store → undefined; v0.2 adicionará file lock via D61. **DOCUMENT no JSDoc**: "JsonFileTaskStore is single-process; concurrent writers may corrupt the store. Use only when TaskRegistry runs in exactly one process."
- EC-7 cross-process cancel: `update` aceita mutator que set `cancelRequested: true`; CLI usa esse caminho. Não muda invariantes de path/permission.

#### Tasks
1. Criar `internal/task/store.ts` com interface + 2 implementations.
2. Implementar factory `getTaskStoreFor(opts: TaskStoreOptions)`.
3. Unit tests cobrindo insert/update/get/list/delete/evict em ambas implementations.
4. JsonFile: testar atomic write via temp file + rename.
5. JsonFile: testar corrupt JSON degrades graciosamente.

#### TDD
```
RED:     test_inmemory_insert_get_returns_handle()
RED:     test_inmemory_update_via_mutation_fn()
RED:     test_inmemory_list_filters_by_state()
RED:     test_inmemory_evict_removes_terminal_only_when_older_than_cutoff()
RED:     test_jsonfile_insert_persists_to_disk()
RED:     test_jsonfile_atomic_write_via_rename()
RED:     test_jsonfile_corrupt_json_skips_gracefully()
RED:     test_jsonfile_list_caps_at_256_loaded()
RED:     test_jsonfile_fallback_to_cwd_theokit_when_env_unset()
RED:     test_jsonfile_constructor_creates_dir_if_missing() — EC-1: mkdir recursive idempotent
RED:     test_jsonfile_insert_rejects_invalid_id_grammar() — EC-2: defense-in-depth path-traversal guard
RED:     test_jsonfile_list_returns_empty_on_enoent() — EC-6: fresh-install fresh-dir
RED:     test_jsonfile_list_ignores_orphan_tmp_files() — EC-8: atomic-write crash residue
GREEN:   Implementar InMemoryTaskStore + JsonFileTaskStore + factory
REFACTOR: Extract shared atomic-write helper para internal/persistence/ se útil
VERIFY:  pnpm -F @usetheo/sdk exec vitest run tests/internal/task/store.test.ts
```

#### Acceptance Criteria
- [ ] Interface `TaskStore` com 6 métodos exposta em `internal/task/store.ts`
- [ ] `InMemoryTaskStore` passa todos unit tests
- [ ] `JsonFileTaskStore` passa todos unit tests incluindo corrupt/concurrent/EC-1/EC-2/EC-6/EC-8
- [ ] `JsonFileTaskStore` construtor cria dir recursive (EC-1)
- [ ] Todas operações de I/O validam ID grammar D368 (EC-2)
- [ ] `list()` retorna `[]` em ENOENT ao invés de throw (EC-6)
- [ ] `list()` ignora arquivos `.tmp.*` órfãos (EC-8)
- [ ] JSDoc de `list()` documenta cap 256 + paginação via `submittedBefore` (EC-14)
- [ ] JSDoc da classe documenta single-process invariant (EC-15)
- [ ] `getTaskStoreFor({ backend: "memory" })` retorna InMemory
- [ ] `getTaskStoreFor({ backend: "json", dir })` retorna JsonFile com dir resolvido
- [ ] Pass: complexity check (≤ 10 por function)
- [ ] Pass: coverage check (store.ts ≥ 90%)
- [ ] Pass: size check (store.ts ≤ 400 lines)

#### DoD
- [ ] `pnpm -F @usetheo/sdk exec vitest run tests/internal/task/store.test.ts` 13+ tests passing (9 originais + 4 edge cases EC-1/EC-2/EC-6/EC-8)
- [ ] biome zero warnings em internal/task/
- [ ] knip zero unused exports

---

## Phase 3: TaskRegistry (singleton) + AsyncSemaphore wiring

**Objective:** O coração do sistema — registry que combina store + concurrency control + event ring buffer + cancel propagation.

### T3.1 — TaskRegistry skeleton

#### Objective
Singleton in-process que coordena submit/list/get/cancel/subscribe + ring buffer + AsyncSemaphore + AbortController per task.

#### Files to edit
```
packages/sdk/src/internal/task/registry.ts (NEW) — TaskRegistry singleton class
packages/sdk/src/internal/task/registry.test.ts (NEW)
packages/sdk/src/internal/task/ring-buffer.ts (NEW) — event replay buffer cap 64
packages/sdk/src/internal/task/ring-buffer.test.ts (NEW)
```

#### Deep file dependency analysis
- `registry.ts` depende de `store.ts` (T2.1), `types/task.ts` (T1.1), `internal/runtime/async-semaphore.ts` (D135).
- `ring-buffer.ts` é zero-dep, puro array com índice circular.
- Será consumido pelo Public API (T4.1) + runtime adapters (T3.2-T3.5).

#### Deep Dives

**Singleton lifecycle:**
```ts
class TaskRegistry {
  private store: TaskStore;
  private semaphore: AsyncSemaphore;
  private aborters = new Map<string, AbortController>();
  private buffers = new Map<string, RingBuffer<TaskEvent>>();
  private subscribers = new Map<string, Set<(e: TaskEvent) => void>>();
  private retentionMs = 60 * 60 * 1000; // 1h default
  private evictTimer?: NodeJS.Timeout;

  static instance(): TaskRegistry { ... } // getter retornando singleton

  configure(opts: TaskRegistryOptions): void { ... } // reset singleton state
  async submit(kind, work, opts): Promise<TaskHandle> { ... }
  async list(filter): Promise<TaskHandle[]> { ... }
  async get(id): Promise<TaskHandle | undefined> { ... }
  async cancel(id, reason?): Promise<{ cancelled: boolean; alreadyTerminal: boolean }> { ... }
  subscribe(id): AsyncIterable<TaskEvent> { ... }
}
```

**Submit flow:**
1. Validate `opts.id` grammar (D368) ou auto-gen UUID.
2. **EC-4 (MUST FIX) — abort-already-set short-circuit**: se `opts.signal?.aborted === true`, insert handle direto com `state: "cancelled"`, emit `submitted` + `cancelled`, SKIP queue/semaphore inteiramente. Return handle.
3. Single-flight check (D367): se ID já existe, retorna handle existente sem reinvoke.
4. Insert handle `state: "queued"` no store + criar AbortController + ring buffer.
5. Emit `submitted` event.
6. Acquire semaphore slot (D369).
7. Transition `running`, emit `started`.
8. **EC-3 (MUST FIX) — sync throws normalization**: chamar work como `Promise.resolve().then(() => work({ signal, emit(progress) }))` ao invés de `await work(...)` direto. Garante que sync throw vire rejected Promise sem bypassar o try/catch.
9. **EC-9 (SHOULD TEST) — store.update failure resilience**: cada `store.update` está em try/catch; se falhar, log stderr + emit event mesmo assim, e força handle pra `error` state com `error.code = "store_update_failed"`. Subscribers nunca perdem o evento terminal.
10. Transition `finished | error | cancelled` baseado em resultado/erro/abort.
11. Release semaphore.
12. **EC-7 cross-process** — antes de start E em cada progress event, checar `handle.cancelRequested === true` (set por CLI em processo externo). Se true, chamar `aborter.abort("cancelRequested")`. Best-effort com latência até próximo checkpoint.
13. Notify subscribers.

**Cancel flow:**
1. Get handle from store. Se `undefined` → no-op return `{ cancelled: false, alreadyTerminal: false }`.
2. Se terminal → return `{ cancelled: false, alreadyTerminal: true }`.
3. Se `queued`: update handle direto pra `cancelled` + emit event + clean up resources.
4. Se `running`: chamar `aborter.abort(reason)`. AbortController triggera o work fn que vai resolver naturalmente — registry vê transition.

**Subscribe flow:**
1. Get ring buffer for taskId. Se não existe → throw `TaskNotFoundError`.
2. Drain buffer (yield todos events já gravados, com flag `truncated: true` no primeiro yield se buffer estiver na cap).
3. Register subscriber callback no Set.
4. Yield events conforme chegam.
5. **EC-10 (SHOULD TEST) — leak-free cleanup**: AsyncIterable implementa `return()` explicitamente (não confia em GC). Quando consumer abandona (break do for-await, .return() manual, ou exception), `return()` faz `subscribers.get(taskId)?.delete(callback)`. Verificar via `__getSubscribersCountForTests()` que count → 0.

**EC-11 (SHOULD TEST) — reentrant submit**: work() pode chamar `Task.submit` aninhado. Sob `maxConcurrent: 1` isso seria deadlock. Solução: registry mantém `AsyncLocalStorage<{ isInsideWork: true }>`. Quando submit é chamado com `isInsideWork === true`, semaphore acquire pula a fila (priority shortcut) ao invés de aguardar. Documentar no JSDoc do Task.submit: "Reentrant submit (work fn → Task.submit) bypassa o semaphore para evitar deadlock; concurrency cap pode ser excedida temporariamente em cadeias profundas."

**Eviction:**
- Timer `setInterval` a cada 5min chama `store.evictTerminalOlderThan(now - retentionMs)`.
- Também limpa `aborters`, `buffers`, `subscribers` entries para tasks evicted.

**Edge cases:**
- Submit em registry não-configurado → usa defaults (InMemoryStore + concurrency 8 + retention 1h).
- Cancel de taskId desconhecido → no-op silent (não throw — idempotência).
- Subscribe a taskId que foi evicted → throw `TaskNotFoundError`.
- Process exit com tasks `running` → unhandled. v1 documenta como limitação ("tasks may be left in 'running' state after a crash; restart sees stale entries"); v0.2 adiciona heartbeat + dead-task GC.

#### Tasks
1. Implementar `RingBuffer<T>` (capacity, push, drain, truncated flag).
2. Implementar `TaskRegistry` singleton com submit/list/get/cancel/subscribe.
3. Wire AsyncSemaphore (D135) + AbortController per task.
4. Wire eviction timer.
5. Unit tests cobrindo todos edge cases acima.

#### TDD
```
RED:     test_ring_buffer_push_and_drain()
RED:     test_ring_buffer_overflow_drops_head_marks_truncated()
RED:     test_registry_submit_returns_handle_state_queued()
RED:     test_registry_submit_idempotent_same_id_returns_existing()
RED:     test_registry_invalid_id_throws_invalid_task_id_error()
RED:     test_registry_runs_work_under_semaphore_concurrency_8()
RED:     test_registry_cancel_queued_immediately_transitions_to_cancelled()
RED:     test_registry_cancel_running_propagates_via_aborter()
RED:     test_registry_cancel_idempotent_returns_already_terminal()
RED:     test_registry_subscribe_drains_buffer_before_live_tail()
RED:     test_registry_subscribe_unknown_task_throws_not_found()
RED:     test_registry_eviction_removes_terminal_older_than_retention()
RED:     test_registry_progress_event_visible_in_subscribe()
RED:     test_registry_finished_event_carries_result()
RED:     test_registry_errored_event_carries_error_shape()
RED:     test_registry_submit_with_pre_aborted_signal_short_circuits_to_cancelled() — EC-4
RED:     test_registry_work_sync_throw_normalized_to_rejected_promise() — EC-3
RED:     test_registry_emits_event_even_when_store_update_throws() — EC-9
RED:     test_registry_subscribe_cleanup_on_iterator_return() — EC-10
RED:     test_registry_reentrant_submit_under_concurrency_1_does_not_deadlock() — EC-11
RED:     test_registry_cancel_requested_flag_picked_up_at_next_checkpoint() — EC-7
GREEN:   Implementar registry.ts + ring-buffer.ts
REFACTOR: Extract submit-flow into private helper if cyclomatic > 10
VERIFY:  pnpm -F @usetheo/sdk exec vitest run tests/internal/task/registry.test.ts tests/internal/task/ring-buffer.test.ts
```

#### Acceptance Criteria
- [ ] 21 RED tests now GREEN (15 originais + 6 edge cases EC-3/EC-4/EC-7/EC-9/EC-10/EC-11)
- [ ] Submit/list/get/cancel/subscribe APIs funcionando
- [ ] Pre-aborted signal short-circuita pra cancelled sem ocupar semaphore slot (EC-4)
- [ ] Sync throw em work() é normalizado pra rejected Promise + errored event (EC-3)
- [ ] store.update failure ainda emite event terminal (EC-9)
- [ ] Subscribe iterator cleanup via `return()` zera subscribers count (EC-10)
- [ ] Reentrant submit sob concurrency=1 não deadlock (EC-11) — bypassa semaphore via ALS
- [ ] `cancelRequested` flag no handle é honrado em checkpoints (EC-7)
- [ ] Concorrência throttled via AsyncSemaphore — teste verifica que com concurrency=2 e 4 tasks lentas, apenas 2 estão `running` simultaneamente
- [ ] Cancel propaga via AbortController (test usa `signal.aborted` inside work fn)
- [ ] Eviction roda no timer + manual via `evict()` para testabilidade
- [ ] Subscribe respeita replay buffer cap 64
- [ ] `__getSubscribersCountForTests(taskId)` exposto pra validar cleanup (EC-10)
- [ ] Pass: complexity ≤ 10 por function
- [ ] Pass: coverage ≥ 90%
- [ ] Pass: size ≤ 500 lines registry.ts

#### DoD
- [ ] `pnpm -F @usetheo/sdk exec vitest run tests/internal/task/` 31+ tests passing (25 originais + 6 EC)
- [ ] Zero warnings biome
- [ ] Singleton reset helper `__resetTaskRegistryForTests()` exposto
- [ ] Test helpers `__getSubscribersCountForTests(taskId)` + `__getCancelRequestedForTests(taskId)` expostos para verificação interna

---

### T3.2 — Adapter: Run → Task (agent.send opt-in)

#### Objective
Quando caller passa `{ task: true }` para `agent.send`, a Run inteira é automaticamente registrada como Task.

#### Files to edit
```
packages/sdk/src/internal/runtime/local-agent.ts — adicionar branch task-aware no .send()
packages/sdk/src/internal/runtime/run-impl.ts — emit progress events para registry quando taskId presente
packages/sdk/src/types/agent.ts — adicionar `task?: true | { id?: string; meta?: Record<string, unknown> }` ao SendOptions
packages/sdk/src/agent.ts — atualizar facade docs
packages/sdk/tests/integration/run-as-task.test.ts (NEW) — integration test com fixture LLM
```

#### Deep file dependency analysis
- `local-agent.ts` é o entry de `agent.send`; mudança é adicionar ramo opt-in NÃO alterando o path default.
- `run-impl.ts` recebe optional taskId via constructor; quando presente, emite progress events ao registry mid-stream.
- `types/agent.ts` SendOptions é o tipo público mais tocado da SDK — mudança é additive (campo opcional).

#### Deep Dives

**SendOptions extension (backward compat):**
```ts
interface SendOptions {
  // ... existing fields
  task?: true | { id?: string; meta?: Record<string, unknown> };
}
```

Quando `task` é truthy:
- Antes de start, `TaskRegistry.instance().submit("run", workFn, opts)` retorna handle.
- `workFn({ signal, emit }) → result`:
  - Cria Run com `signal` (abort propaga inwards).
  - Stream SDK messages — para cada chunk, chama `emit({ type: "progress", payload: chunk })`.
  - Return final result on completion.

**Return shape mudança:**
Sem `task`: `agent.send(prompt)` retorna `Run` (current behavior).
Com `task: true`: `agent.send(prompt, { task: true })` retorna `{ run: Run; taskId: string }` — caller pode usar Run normalmente E inspecionar via TaskRegistry.

**Edge cases:**
- Caller passa `task: { id: "x" }` em paralelo com outro caller mesmo ID → D367 single-flight: ambos recebem mesma Run? NÃO — submit retorna handle existente, mas Run real é só uma. Segundo caller recebe `run: Run` que faz tail do registry events. **DOCUMENT**: "Concurrent submit with same ID returns the first Run; second caller observes via subscribe."
- Cancel via TaskRegistry → Run vê `signal.aborted`, finaliza com status cancelled.
- Cancel via Run abort method → Task vê handle transition pra `cancelled`.

#### Tasks
1. Estender `SendOptions.task` no types/agent.ts.
2. No `local-agent.ts`, ramo task-aware: submeter ao registry, retornar tupla `{ run, taskId }`.
3. No `run-impl.ts`, aceitar optional `onProgress` callback no constructor.
4. Wire `onProgress` para emit ao registry quando taskId presente.
5. Integration test: send com task=true, list registry, ver state transitions, cancelar mid-stream.

#### TDD
```
RED:     test_send_without_task_returns_run_unchanged() — backward compat absoluto
RED:     test_send_with_task_true_returns_run_and_taskId()
RED:     test_send_with_task_id_specified_uses_that_id()
RED:     test_send_with_task_emits_progress_per_chunk()
RED:     test_send_with_task_cancel_via_registry_aborts_run()
RED:     test_send_with_task_finishes_emits_finished_event_with_result()
RED:     test_concurrent_submit_same_id_second_caller_sees_existing_run()
GREEN:   Implementar branch task-aware no LocalAgent.send + RunImpl.onProgress hook
REFACTOR: Extract task-wrapping helper se LocalAgent.send virar >50 linhas
VERIFY:  pnpm -F @usetheo/sdk exec vitest run tests/integration/run-as-task.test.ts
```

#### Acceptance Criteria
- [ ] 7 integration tests GREEN
- [ ] `agent.send(prompt)` sem option permanece byte-by-byte idêntico (backward compat)
- [ ] `agent.send(prompt, { task: true })` retorna `{ run, taskId }` com run usável
- [ ] Cancel via `Task.cancel(id)` ou `run.abort()` ambos resultam em transition `cancelled`
- [ ] Progress events disponíveis via `Task.subscribe(id)`
- [ ] Pass: complexity ≤ 10
- [ ] Pass: backward-compat test sweep — todos existing send tests verdes

#### DoD
- [ ] 7 RED tests passam
- [ ] `pnpm -F @usetheo/sdk run typecheck` exit 0
- [ ] Zero regressions em testes de Run existentes (run-full all 1700+)

---

### T3.3 — Adapter: Batch → Tasks (1 batch = N child tasks)

#### Objective
`Agent.batch(prompts, { task: true })` cria 1 parent task + N child tasks (1 por prompt).

#### Files to edit
```
packages/sdk/src/batch.ts — estender BatchOptions com task hook
packages/sdk/src/internal/runtime/batch-impl.ts — wire registry submit per-prompt
packages/sdk/tests/integration/batch-as-tasks.test.ts (NEW)
```

#### Deep file dependency analysis
- `batch.ts` é a facade pública; mudança additive no options.
- `batch-impl.ts` já usa AsyncSemaphore (D135) internamente — wire registry submit por prompt sem mudar semantics de erro isolation (D137).

#### Deep Dives

**BatchOptions extension:**
```ts
interface BatchOptions {
  // ... existing
  task?: true | { parentId?: string; childMetaFn?: (i: number) => Record<string, unknown> };
}
```

**Behavior:**
- Quando `task: true`: registry recebe 1 task `kind: "batch"` (parent) + N tasks `kind: "run"` com `meta.parentId = parentTaskId`.
- Parent task id namespaced: `b-{uuid}` (EC-5 namespace disjoint).
- Parent state agregado: `running` enquanto qualquer child está running; `finished` quando todos children terminais; `error` se algum child error; `cancelled` se cancel propagou.
- `Task.list({ kind: "batch" })` retorna parents; `Task.list({ kind: "run", parentId })` retorna children.
- **EC-12 (SHOULD TEST) — parent state monotonic invariant**: parent state aggregation roda em mutex in-process. Cada child transition triggera `recomputeParent(parentId)` que executa serialmente (Promise chain). Garante que parent state observable nunca volta atrás (`running → finished` ou `running → error`, nunca `finished → running`). Test fuzz com 10 children finishing em ordem aleatória + 1000 list() calls concurrent assertando monotonicity.

**Edge cases:**
- AbortSignal externo passado pro batch → propaga pra parent task → propaga pra todos children running (D140).
- Erro em 1 child não cancela siblings (D137 failure isolation preserved).

#### Tasks
1. Estender BatchOptions.task.
2. Implementar parent/child wiring em batch-impl.
3. Aggregated parent state machine.
4. Integration test cobrindo parent/children states.

#### TDD
```
RED:     test_batch_without_task_unchanged_behavior()
RED:     test_batch_with_task_creates_1_parent_n_children()
RED:     test_batch_parent_state_running_while_any_child_running()
RED:     test_batch_parent_state_finished_when_all_children_terminal()
RED:     test_batch_parent_state_error_when_any_child_error()
RED:     test_batch_cancel_parent_cancels_all_children()
RED:     test_batch_child_meta_includes_parentId()
RED:     test_batch_parent_id_uses_b_prefix() — EC-5 namespace
RED:     test_batch_parent_state_consistent_under_concurrent_child_transitions() — EC-12 monotonic
GREEN:   Wire registry no batch-impl
REFACTOR: None expected
VERIFY:  pnpm -F @usetheo/sdk exec vitest run tests/integration/batch-as-tasks.test.ts
```

#### Acceptance Criteria
- [ ] 7 RED tests GREEN
- [ ] Backward compat: `Agent.batch(prompts)` sem opção segue idêntico
- [ ] Failure isolation preservada (D137)
- [ ] AbortSignal propagation preservada (D140)
- [ ] Pass: complexity ≤ 10
- [ ] Pass: coverage ≥ 90%

#### DoD
- [ ] 7 tests passing
- [ ] Existing batch tests sem regressão

---

### T3.4 — Adapter: Workflow → Task

#### Objective
`Workflow.run(input, { task: true })` registra a execução do workflow como task.

#### Files to edit
```
packages/sdk/src/workflow.ts — estender RunOptions
packages/sdk/src/internal/workflow/executor.ts — wire registry submit
packages/sdk/tests/integration/workflow-as-task.test.ts (NEW)
```

#### Deep file dependency analysis
- `workflow.ts` facade já tem RunOptions; campo `task` additive.
- `executor.ts` é onde o run loop vive; cada step transition emite progress event no registry quando taskId presente.
- Workflow já tem `runId` (D242 single-flight per workflowId+runId) — quando `task: true`, registry SEMPRE prefixa: `taskId = "wf-" + runId`. **EC-5 (MUST FIX)**: namespace disjoint evita colisão com user-provided taskIds em `Task.submit("custom", ...)`. Mesmo padrão pra batch (`b-`) e cron (`cron-`). Garantia: usuário que passa `id: "wf-foo"` em `Task.submit` recebe `InvalidTaskIdError` (prefixos reservados validados em T1.1 + D368).

#### Deep Dives

**Step transitions → progress events:**
- Cada step start/end emite `{ type: "progress", payload: { stepId, phase: "start"|"end", at } }`.
- Workflow `suspend()` emite `{ type: "progress", payload: { stepId, phase: "suspended" } }`.
- Workflow finish → registry transition `finished` com `result: WorkflowOutput`.

**Cancel propagation:**
- `Task.cancel(taskId)` → workflow signal abort → AbortSignal at step boundaries (D245) → step.fn vê `ctx.signal.aborted` → step encerra → workflow transition `cancelled`.

#### Tasks
1. Estender RunOptions.task no workflow.ts.
2. Wire registry no executor.ts step transitions.
3. Map workflow runId → task id quando configured.
4. Integration test.

#### TDD
```
RED:     test_workflow_run_with_task_creates_task_kind_workflow()
RED:     test_workflow_step_transitions_emit_progress_events()
RED:     test_workflow_cancel_via_task_aborts_at_step_boundary()
RED:     test_workflow_suspend_emits_suspended_progress()
RED:     test_workflow_runId_prefixed_with_wf_in_taskId() — EC-5 namespace
RED:     test_task_submit_with_reserved_wf_prefix_throws_invalid_task_id_error() — EC-5 user-side reject
GREEN:   Wire executor.ts + adicionar prefix validation em D368 grammar
REFACTOR: None expected
VERIFY:  pnpm -F @usetheo/sdk exec vitest run tests/integration/workflow-as-task.test.ts
```

#### Acceptance Criteria
- [ ] 6 RED tests GREEN (5 originais + EC-5 prefix reject)
- [ ] Workflow backward compat preserved (D108)
- [ ] Step boundary abort respected (D245)
- [ ] Prefixos `wf-`/`b-`/`cron-` rejeitados em user-supplied submit IDs (EC-5)
- [ ] Pass: complexity ≤ 10

#### DoD
- [ ] 6 tests passing

---

### T3.5 — Adapter: Cron → Task (cada fire = 1 task)

#### Objective
Cada disparo de cron job vira uma task observable.

#### Files to edit
```
packages/sdk/src/cron.ts — adicionar registerJobAsTask option
packages/sdk/src/internal/cron/dispatcher.ts (ou equivalente) — submit ao registry quando configured
packages/sdk/tests/integration/cron-as-task.test.ts (NEW)
```

#### Deep file dependency analysis
- `cron.ts` é facade existente; new option additive.
- Dispatcher do croner (D7) recebe wrapper que faz registry submit antes de invocar job handler.
- Cada fire cria task `kind: "cron"` com `meta.jobName` + `meta.firedAt`.

#### Deep Dives

**Auto-eviction de cron tasks:** cron pode disparar frequentemente; default retention 1h pode acumular muitas. `Cron.register({ name, schedule, handler, task: { retentionMs: 24 * 60 * 60 * 1000 } })` permite override por job.

**Cancel um cron fire:** `Task.cancel(taskId)` aborta o fire atual mas NÃO desregistra o cron job. Pra desabilitar o job inteiro continua sendo `Cron.delete(name)`.

**Cron task id namespace:** `taskId = "cron-{jobName}-{fireTs}"` (EC-5 disjoint).

**EC-16 (DOCUMENT) — alta frequência:** cron jobs com schedule sub-segundo geram alto volume de tasks (every-second × 1h = 3600 entries). Auto-eviction limpa após retention, mas pico transiente é alto. Cookbook recomenda override per-job: `Cron.register({ name, schedule, handler, task: { retentionMs: 60_000 } })` para jobs frequentes.

#### Tasks
1. Estender Cron.register options.
2. Wire dispatcher.
3. Integration test com schedule curto (every 2s, observa 2 fires no registry).

#### TDD
```
RED:     test_cron_fire_creates_task_kind_cron()
RED:     test_cron_fire_task_includes_jobName_in_meta()
RED:     test_cron_fire_cancel_aborts_current_handler_only()
RED:     test_cron_fires_accumulate_as_distinct_tasks()
RED:     test_cron_task_id_uses_cron_prefix() — EC-5 namespace
RED:     test_cron_per_job_retention_override_respected() — EC-16 mitigation
GREEN:   Wire dispatcher
REFACTOR: None expected
VERIFY:  pnpm -F @usetheo/sdk exec vitest run tests/integration/cron-as-task.test.ts
```

#### Acceptance Criteria
- [ ] 4 RED tests GREEN
- [ ] Cron job desregistro inalterado
- [ ] Per-job retention override funcional
- [ ] Pass: complexity ≤ 10

#### DoD
- [ ] 4 tests passing

---

## Phase 4: Public API (`Task` namespace static class)

**Objective:** Expor `Task.submit / list / get / cancel / subscribe / configure` como API pública.

### T4.1 — `packages/sdk/src/task.ts` (NEW)

#### Objective
Facade público que delega ao TaskRegistry singleton.

#### Files to edit
```
packages/sdk/src/task.ts (NEW)
packages/sdk/src/index.ts — re-export Task namespace
packages/sdk/tests/task-facade.test.ts (NEW)
```

#### Deep file dependency analysis
- `task.ts` é facade thin; delega 100% ao registry.
- `index.ts` ganha 1 linha re-export.
- Pattern espelha `cron.ts`, `eval.ts`, `workflow.ts`.

#### Deep Dives

**API shape final:**
```ts
export class Task {
  private constructor() { throw new Error("Task is static; do not instantiate"); }

  /**
   * EC-13: configure() chamada após primeiro submit emite uma única linha em stderr:
   *   `[task] configure() ignored — registry already in use; reset via __resetTaskRegistryForTests()`
   * Opts NÃO são aplicadas (preserva determinismo). Apenas no-op visível.
   */
  static configure(opts: {
    store?: TaskStoreOptions;
    maxConcurrent?: number;
    retentionMs?: number;
  }): void;

  static async submit<T>(
    kind: TaskKind,
    work: (ctx: { signal: AbortSignal; emit: (payload: unknown) => void }) => Promise<T>,
    options?: TaskSubmitOptions,
  ): Promise<TaskHandle>;

  static async list(filter?: TaskFilter): Promise<TaskHandle[]>;
  static async get(id: string): Promise<TaskHandle | undefined>;
  static async cancel(id: string, reason?: string): Promise<{ cancelled: boolean; alreadyTerminal: boolean }>;
  static subscribe(id: string): AsyncIterable<TaskEvent>;
}
```

#### Tasks
1. Criar `task.ts` com static class.
2. Re-export.
3. Tests cobrindo cada método via facade.

#### TDD
```
RED:     test_task_static_class_constructor_throws()
RED:     test_task_submit_returns_handle()
RED:     test_task_list_returns_array()
RED:     test_task_get_returns_handle_or_undefined()
RED:     test_task_cancel_returns_idempotent_shape()
RED:     test_task_subscribe_returns_async_iterable()
RED:     test_task_configure_resets_singleton_state()
RED:     test_task_configure_after_first_submit_warns_to_stderr() — EC-13 no-op after-submit
GREEN:   Implementar facade
REFACTOR: None expected
VERIFY:  pnpm -F @usetheo/sdk exec vitest run tests/task-facade.test.ts
```

#### Acceptance Criteria
- [ ] 7 RED tests GREEN
- [ ] `import { Task } from "@usetheo/sdk"` resolves
- [ ] Cada método delega corretamente ao registry
- [ ] Pass: complexity ≤ 10
- [ ] Pass: size ≤ 200 lines

#### DoD
- [ ] 7 tests passing
- [ ] Typecheck verde

---

## Phase 5: Telemetry + cancellation polish

**Objective:** OTel spans (D371) + dev-mode invariant checks.

### T5.1 — Telemetry spans

#### Files to edit
```
packages/sdk/src/internal/task/telemetry.ts (NEW)
packages/sdk/src/internal/task/registry.ts — call telemetry hooks
packages/sdk/tests/internal/task/telemetry.test.ts (NEW)
```

#### Deep Dives
- 3 spans: `task.submit`, `task.transition`, `task.cancel`.
- Cada span carrega attrs: `task.id`, `task.kind`, `task.state.from`, `task.state.to`.
- Lazy load OTel via existing seam (D34); safe-noop quando ausente.

#### Tasks
1. `telemetry.ts` com 3 helpers que `safe()`-wrap OTel calls.
2. Wire no registry.
3. Unit test verifica spans emitidos via mock tracer.

#### TDD
```
RED:     test_submit_emits_task_submit_span()
RED:     test_transition_emits_task_transition_span_with_from_to()
RED:     test_cancel_emits_task_cancel_span()
RED:     test_telemetry_noop_when_otel_absent()
GREEN:   Implementar telemetry hooks
REFACTOR: None expected
VERIFY:  pnpm -F @usetheo/sdk exec vitest run tests/internal/task/telemetry.test.ts
```

#### Acceptance Criteria
- [ ] 4 tests GREEN
- [ ] OTel optional — sem peer instalada, registry continua funcional
- [ ] Pass: complexity ≤ 10

#### DoD
- [ ] 4 tests passing

---

## Phase 6: CLI verb `theokit tasks {list|inspect|cancel}`

**Objective:** Operator inspeciona tasks via CLI (parallel ao programmatic API).

### T6.1 — CLI subcommand

#### Files to edit
```
packages/cli/src/commands/tasks.ts (NEW)
packages/cli/src/main.ts — program.command("tasks")
packages/cli/tests/tasks.test.ts (NEW)
```

#### Deep Dives

**Subcomandos:**
- `theokit tasks list [--state X] [--kind Y] [--json]` — tabela ou JSON.
- `theokit tasks inspect <id> [--json]` — handle + últimos 64 events (do disco quando JsonFile; in-memory NÃO acessível cross-process).
- `theokit tasks cancel <id> [--reason X]` — best-effort cross-process (ver EC-7).

**Storage:** CLI default lê de `JsonFileTaskStore` em `$THEOKIT_HOME/tasks/` (cross-invocation persistence). Sem `THEOKIT_HOME` → fallback `cwd/.theokit/tasks`.

**EC-7 (MUST FIX) — cross-process cancel é best-effort:** o `AbortController` real vive no processo que submeteu a task. CLI rodando em outro processo NÃO tem acesso direto. Solução em v1:

1. CLI `tasks cancel <id>` faz `store.update(id, h => ({ ...h, cancelRequested: true }))` e exit 0 com mensagem:
   > `cancel requested for task <id>; the owning process will honor it at the next checkpoint`
2. TaskRegistry (no processo origem) polla `handle.cancelRequested` em cada checkpoint: (a) antes de `state: running` start, (b) a cada progress event, (c) no on-cancel hook. Se `true` → chama `aborter.abort("cancelRequested")`.
3. Se task já está terminal no momento do CLI cancel → CLI exit 0 com `task already terminal`.
4. Se task `state: queued` (registry origem ainda não pegou da queue) → CLI pode transicionar direto pra `cancelled` no store (estado é compartilhado via disco). Próximo poll do registry vê handle terminal e skip.

**Limitação documentada:** se o processo origem crashed enquanto a task estava `running`, a flag `cancelRequested` fica sem ninguém pra honrar. Stale tasks em `running` requerem cleanup manual (`theokit tasks cancel` + `--force` que move pra `error` direto no store). `--force` flag entra como v0.2.

**Outros edge cases:**
- ENOENT em store dir (fresh install) → store.list() retorna `[]` (EC-6 fix no store layer); CLI imprime "No tasks found." e exit 0.
- Diretório sem permissão → exit 2 com mensagem clara.
- Task ID inválido (grammar D368) → exit 3.
- Task não encontrada (inspect/cancel) → exit 4.

#### Tasks
1. `tasks.ts` com 3 subcomandos via commander.
2. Wire no main.ts.
3. Tests cobrindo cada subcomando via tmpdir fixture store.

#### TDD
```
RED:     test_cli_tasks_list_prints_table()
RED:     test_cli_tasks_list_json_outputs_valid_json()
RED:     test_cli_tasks_list_empty_on_fresh_install_exit_0() — EC-6 ENOENT path
RED:     test_cli_tasks_inspect_shows_handle_plus_events()
RED:     test_cli_tasks_cancel_running_sets_cancelRequested_flag() — EC-7 best-effort
RED:     test_cli_tasks_cancel_queued_transitions_to_cancelled_directly() — EC-7 queued shortcut
RED:     test_cli_tasks_cancel_terminal_prints_already_terminal_exit_0() — EC-7 idempotent
RED:     test_cli_tasks_unknown_id_exits_4()
RED:     test_cli_tasks_invalid_id_grammar_exits_3()
GREEN:   Implementar subcommand
REFACTOR: Extract output formatters se complexity > 10
VERIFY:  pnpm -F @usetheo/cli exec vitest run tests/tasks.test.ts
```

#### Acceptance Criteria
- [ ] 9 RED tests GREEN (5 originais + 4 edge cases EC-6/EC-7 múltiplos)
- [ ] `theokit tasks --help` lista 3 subcomandos
- [ ] Exit codes consistentes (0 OK, 2 permission, 3 invalid id, 4 not found)
- [ ] CLI cancel `running` task seta `cancelRequested: true` no store + mensagem clara ao usuário (EC-7)
- [ ] CLI cancel `queued` task transiciona pra `cancelled` direto via store (EC-7)
- [ ] CLI cancel terminal task exit 0 com `already terminal` (EC-7 idempotent)
- [ ] CLI list em fresh-install (sem store dir) exit 0 com "No tasks found." (EC-6)
- [ ] Pass: complexity ≤ 10
- [ ] Pass: coverage ≥ 85%

#### DoD
- [ ] 9 tests passing
- [ ] CHANGELOG.md packages/cli atualizado com nota sobre best-effort cancel cross-process

---

## Phase 7: Docs + example + dogfood

**Objective:** Validar end-to-end com real LLM + telegram-pro + docs landed.

### T7.1 — Concept page + cookbook recipe

#### Files to edit
```
theo-opendocs/content/theokit-sdk/concepts/tasks.mdx (NEW)
theo-opendocs/content/theokit-sdk/cookbook/observe-async-tasks.mdx (NEW)
packages/sdk/CHANGELOG.md
packages/cli/CHANGELOG.md
CHANGELOG.md (workspace)
```

#### Tasks
1. Concept page cobrindo lifecycle + estados + store options.
2. Cookbook recipe: fan-out batch with progress + cancel mid-stream.
3. Update changelogs com entry sob [Unreleased].

#### TDD
```
N/A — docs/cookbook são prose + code blocks. Validation via cookbook auto-gen smoke (existing in theo-opendocs).
```

#### Acceptance Criteria
- [ ] Concept page ≥ 400 palavras com code samples
- [ ] Cookbook recipe runável standalone
- [ ] Changelog entries em 3 arquivos

#### DoD
- [ ] `pnpm --filter @theo/opendocs run types:check` verde
- [ ] Cookbook auto-gen drift checker clean

---

### T7.2 — Real-LLM dogfood (telegram-pro `/tasks` command)

#### Objective
Validar Task API com LLM real conforme `.claude/rules/real-llm-validation.md`.

#### Files to edit
```
examples/telegram-pro/src/index.ts — adicionar `/tasks list` + `/tasks cancel <id>` commands
.claude/skills/dogfood/lib/dogfood.mjs — adicionar `/tasks` entries no COMMANDS array
.claude/knowledge-base/reviews/tasks-dogfood-{YYYY-MM-DD}.md (NEW)
```

#### Deep Dives

**Bot commands:**
- `/batch jazz` (existing) — atualizar pra usar `Agent.batch(..., { task: true })`, retornar parentTaskId pro usuário.
- `/tasks` — lista tasks ativas do user. Filter por meta.userId (caller injeta).
- `/tasks cancel <id>` — cancela task. Mostra "cancelled" ou "already terminal".

**Dogfood acceptance:**
- Dispara batch → vê parent task `running` → child tasks accumulating → todos terminam → parent `finished`.
- Cancela parent mid-flight → todos children abortam.
- Lista cron tasks (existing /loop) — vê fires acumulados.

#### Tasks
1. Estender telegram-pro com 3 novos comandos.
2. Atualizar dogfood suite.
3. Rodar `/dogfood full` e gerar report.

#### Acceptance Criteria
- [ ] Suite dogfood verde (≥ 47 commands PASS, 0 FAIL)
- [ ] Real LLM observado em ≥ 1 batch task (não fixture)
- [ ] Cancel mid-flight realmente aborta (verificado via logs do bot)

#### DoD
- [ ] Report `.claude/knowledge-base/reviews/tasks-dogfood-{YYYY-MM-DD}.md` registrado
- [ ] Zero regressões telegram-pro

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Submit job assíncrono e receber taskId | T3.1 (registry submit), T4.1 (facade Task.submit) | API pública opt-in via `Task.submit` ou `{ task: true }` em send/batch/workflow |
| 2 | Listar tasks ativas / históricas | T3.1, T4.1, T6.1 | `Task.list(filter)` programmatic + `theokit tasks list` CLI |
| 3 | Inspecionar status + progresso | T3.1 (subscribe), T4.1, T6.1 | `Task.get(id)` + `Task.subscribe(id)` AsyncIterable + `theokit tasks inspect` |
| 4 | Cancelar task em qualquer estado | T3.1 (cancel idempotent), T4.1, T6.1 | `Task.cancel(id)` propaga via ALS+AbortController; queued = direct transition; CLI cross-process = `cancelRequested` flag (EC-7) |
| 5 | Persistência cross-restart opcional | T2.1 (JsonFileTaskStore), D364 | `Task.configure({ store: { backend: "json", dir }})` |
| 6 | Backward compat Run/Batch/Workflow/Cron | T3.2/3.3/3.4/3.5, D363 | Wrapping é opt-in via `{ task: true }`; default behavior idêntico |
| 7 | 5 estados claros sem kanban semantics | D362 | Closed enum 5 valores |
| 8 | Concorrência controlada | D369, T3.1 | AsyncSemaphore default 8 (reusa D135) |
| 9 | Cloud rejection clara | D370, T1.1 | UnsupportedTaskOperationError shape consistente com D122/D169 |
| 10 | Telemetry observável | D371, T5.1 | 3 OTel spans via Telemetry seam D34 |
| 11 | Late-attach subscriber não perde events iniciais | D372, T3.1 | Ring buffer 64 events + replay flag truncated |
| 12 | Sem memory leak | D373, T3.1, EC-10 | Auto-eviction terminal + 1h retention default + iterator cleanup via return() |
| 13 | Composability runtime adapters | D374, T3.2-3.5 | Thin adapters chamam Task.submit, não reimplementam |
| 14 | Inspector CLI | T6.1, D193 | `theokit tasks list/inspect/cancel` |
| 15 | Real-LLM dogfood | T7.2 | telegram-pro `/tasks` + `/batch` via Task wrapping |
| 16 | Docs cookbook | T7.1 | concepts/tasks.mdx + cookbook/observe-async-tasks.mdx |
| 17 | Store dir auto-mkdir (EC-1) | T2.1 | fs.mkdirSync recursive idempotent no construtor |
| 18 | Defense-in-depth ID validation (EC-2) | T2.1 | Cada store op valida grammar D368 antes de path I/O |
| 19 | Sync work() throws normalized (EC-3) | T3.1 | Promise.resolve().then(() => work(ctx)) |
| 20 | Pre-aborted signal short-circuit (EC-4) | T3.1 | submit checks signal.aborted; skip queue/semaphore |
| 21 | Namespaced taskIds (EC-5) | T3.3/T3.4/T3.5, D368 | Prefixos reservados `wf-`/`b-`/`cron-`; user-supplied rejected |
| 22 | Fresh-install ENOENT list (EC-6) | T2.1, T6.1 | Store retorna [] em ENOENT; CLI imprime "No tasks found." |
| 23 | Cross-process cancel best-effort (EC-7) | T6.1, T3.1 | `cancelRequested` flag honored em checkpoints |
| 24 | Orphan .tmp files ignored (EC-8) | T2.1 | scandir filtra `.tmp.*` |
| 25 | store.update failure resilience (EC-9) | T3.1 | catch + emit event even on store failure |
| 26 | Subscribe iterator cleanup (EC-10) | T3.1 | AsyncIterable.return() removes subscriber |
| 27 | Reentrant submit no-deadlock (EC-11) | T3.1 | ALS-based semaphore bypass for inner submits |
| 28 | Parent state monotonic (EC-12) | T3.3 | Recompute serializado via Promise chain mutex |
| 29 | configure() after-submit no-op (EC-13) | T4.1 | Stderr warn, opts ignored |
| 30 | List pagination doc (EC-14) | T2.1 | JSDoc list() documenta cap + submittedBefore loop |
| 31 | Single-process invariant doc (EC-15) | T2.1 | JSDoc class documenta — v0.2 SQLite cobre cross-process |
| 32 | Cron high-frequency anti-pattern doc (EC-16) | T3.5, T7.1 | Cookbook recomenda per-job retentionMs override |

**Coverage: 32/32 (100%) — 16 originais + 16 edge cases absorvidos**

## Global Definition of Done

- [ ] All 8 phases (0-7) completed
- [ ] 14 ADRs (D361-D374) commited
- [ ] All RED tests (≥ 85 across phases — 60 originais + 25 absorvidos via EC-1..EC-16) now GREEN
- [ ] Zero biome/publint/attw warnings on `@usetheo/sdk` and `@usetheo/cli`
- [ ] Zero regressions: full `pnpm -w run validate` exit 0
- [ ] telegram-pro CDP dogfood ≥ 47/47 PASS (0 FAIL); new `/tasks` commands real-LLM validated
- [ ] `Task` namespace exposed from `@usetheo/sdk` index barrel
- [ ] `theokit tasks` subcommand documented in `theokit --help`
- [ ] `JsonFileTaskStore` opt-in cross-restart validated (test + cookbook)
- [ ] Backward compat: existing tests for Run/Batch/Workflow/Cron all green without change
- [ ] CHANGELOG entries: workspace + packages/sdk + packages/cli
- [ ] Concept page + cookbook recipe in `theo-opendocs`
- [ ] All 16 edge cases (EC-1..EC-16) absorvidos OR DOCUMENTED no plano com referência cruzada
- [ ] **Dogfood QA PASS** — `/dogfood full` health score ≥ 70, zero CRITICAL
- [ ] **Runtime-metric proof** — real `task.submit` + `task.transition` OTel spans observados non-zero em dogfood (não só compile-checked); ring buffer replay observable num test contra um subscriber tardio; `cancelRequested` cross-process flag honored em pelo menos 1 cenário smoke (CLI cancel → bot honra no próximo checkpoint, log stderr observado)

## Final Phase: Dogfood QA (MANDATORY)

> This phase runs AFTER all implementation phases are complete. The plan is NOT done until dogfood passes.

**Objective:** Validar real-world end-to-end via telegram-pro CDP suite + manual cookbook walkthrough.

### Execution

Run `/dogfood full`. Always full. No shortcuts.

Additional manual smoke:
1. Em um terminal, rodar `theokit tasks list` enquanto bot processa batch — esperar ver parent + children tasks com prefixo `b-` (EC-5).
2. `theokit tasks cancel <parentId>` em terminal externo (NÃO o do bot) — verificar bot stderr log "[task] cancelRequested honored for b-..." dentro de 1-2 progress events (EC-7 best-effort latência).
3. Children devem abortar via propagação parent→child.
4. Restart bot — verificar (a) terminal tasks ainda visíveis se JsonFile configurado, (b) running tasks marcadas como stale com WARN no stderr.
5. **EC-1 smoke**: deletar `~/.theokit/tasks` antes do start; primeiro `/batch` deve criar dir + submeter sem erro.
6. **EC-6 smoke**: rodar `theokit tasks list` antes de qualquer submit; CLI deve exit 0 com "No tasks found."

### Acceptance Criteria

- [ ] Health score ≥ 70/100
- [ ] Zero CRITICAL issues introduzidas
- [ ] Zero HIGH issues em comandos modificados
- [ ] Pre-existing issues documentadas (não causadas por este plano)
- [ ] Manual smoke 3 cenários passing

### If Dogfood Fails

1. Identify which issues are caused por this plan vs pre-existing
2. Fix all plan-caused CRITICAL and HIGH before declaring done
3. Re-run `/dogfood full`
4. Pre-existing issues logged but do NOT block plan completion
