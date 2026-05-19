# Plan: Background Work Block Completion — Fork Agent + AsyncIterable runUntil + Judge Call

> **Version 1.1** (2026-05-19) — incorporates edge-case review: EC-A simplified (OpenRouter-only judge), EC-B (preserve memory plugins in fork), EC-C/D/E/F (additional tests), EC-G/H/I/J (DOCUMENT notes).
>
> **Version 1.0** — Fecha os 3 patterns do Background work block (`forked-agent-pattern` ❌ → ✅; `async-iterable-streaming` ⚠️ → ✅; `judge-call-pattern` ❌ → ✅). Entrega: (a) `internal/runtime/fork-agent.ts` + `internal/runtime/async-local-storage.ts` com `forkAgent(parent, options)`, `checkToolWhitelist()` cooperating com tool-dispatch, prompt-cache byte-identical inheritance, AsyncLocalStorage per-fork whitelist (NÃO global mutable), auto-deny approval para evitar TUI deadlock, memory-write provenance metadata; (b) `internal/judge/judge-call.ts` + `parse-verdict.ts` + `verify-side-effect.ts` com `judgeCall(ctx, opts)`, `parseVerdict(text)` (DONE/CONTINUE/SKIPPED enum), `verifyClaim(facts, oracle)` side-effect gate; (c) `internal/runtime/run-until.ts` + `types/goal-events.ts` (GoalEvent discriminated union) + `Agent.runUntil(goal, options)` retorna `AsyncGenerator<GoalEvent, GoalResult>` com AbortSignal + `pauseGoal()`/`clearGoal()` controls, `composeContinuation`, consecutive-judge-parse-fail bail. Resultado: Tier 4 macro roadmap parcial — Background work 3/3 ✅; SDK roadmap totais 19 → 22 (96%) DONE; Ralph loop primitive shipa.

## Context

O SDK Patterns Roadmap em `CLAUDE.md` lista 3 patterns abertos no Background work block:

```
| forked-agent-pattern        | ❌ PENDING  | internal/runtime/fork-agent.ts (a criar) |
| async-iterable-streaming    | ⚠️ PARTIAL  | Agent.streamObject (D39) usa; falta Agent.runUntil(goal) |
| judge-call-pattern          | ❌ PENDING  | internal/judge/ (a criar) |
```

**Por que NOW, não LATER:**

1. **Ralph loop primitive missing.** O usuário roda este próprio projeto via **ralph-loop**: loop autônomo com self-evaluation. Hoje o SDK não expõe `Agent.runUntil(goal)` — consumidores precisam reescrever o loop a cada vez (telegram-pro, examples futuros). Hermes shipou esse primitive em `hermes_cli/goals.py:580` e ele virou load-bearing para autonomous-skills (`hermes-deep-dive/02-runUntil-goal.md`).

2. **Fork primitive missing.** Background work patterns (Curator, Kanban worker, multi-agent delegate) PRECISAM de fork — sub-agent com credentials + prompt-cache do parent mas toolset reduzido. Hoje SDK não tem; consumidor precisaria fazer `Agent.create()` novo e perder cache hit (Hermes mede **26% economia** com byte-identical system prompt inheritance, issue #25322). Pior ainda: sem AsyncLocalStorage, paralelo de 2 forks corrompe state um do outro.

3. **Judge primitive missing.** Sem judge externo, qualquer loop autônomo (Ralph, Curator) sofre 2 failure modes documentados: (i) **looping forever** (agent diz "let me try again" repeat) ou (ii) **stopping too early** (agent diz "I think I'm done" mas verdade não). Hermes resolve com judge model separado (default Haiku/gpt-4o-mini), `temperature: 0` mandatory, discriminated `DONE/CONTINUE/SKIPPED` verdict. Plus: **hallucination gate** via side-effect verification (kanban v0.13 #20232).

**Evidência empírica:**

- `ls packages/sdk/src/internal/runtime/fork*` → **arquivo não existe**.
- `ls packages/sdk/src/internal/judge/` → **diretório não existe**.
- `grep -rn "runUntil" packages/sdk/src/` → **0 hits** (somente `streamObject` D39 usa AsyncGenerator).
- `grep -rn "AsyncLocalStorage" packages/sdk/` → **0 hits**.
- `Agent.streamObject` (D39) já é template canonical: `AsyncGenerator<StreamObjectEvent<T>, void, void>` em `packages/sdk/src/stream-object.ts`. `runUntil` mirrors essa shape com return value (Goal result).
- Tier 1-3 macro roadmap completo (commits `defc9a3`, `5ae711a`, `ed6b620`, `abc2f17`). Pré-requisitos (tool-registry, plugin-contract, security-block, agent-core-loop) fechados.
- Knowledge-base completa: `forked-agent-pattern.md` (354 linhas), `async-iterable-streaming.md` (366 linhas), `judge-call-pattern.md` (388 linhas).
- Tool-dispatch site `internal/agent-loop/tool-dispatch.ts:80-103` tem plugin veto wired; **whitelist check é a injeção natural** logo após repair (linha 67) e antes da resolução em `tools.find`.

## Objective

Fechar **Tier 4 (Background work)** parcial do macro roadmap em uma sprint: SDK Patterns Roadmap Background work 3/3 ✅, totais **19 → 22 (96%) DONE**. Adicionar fork+judge+runUntil deve **não quebrar** os 853 testes existentes; deve preservar V1.2 caller API byte-by-byte (`Agent.create`, `send`, `streamObject` intactos). `Agent.runUntil(goal)` deve ser **idiomatic** TypeScript: `for await (const event of agent.runUntil("..."))`.

**Metas mensuráveis:**

1. **`internal/runtime/async-local-storage.ts`** (NOVO) — `toolWhitelistStore` (`AsyncLocalStorage<Set<string>>`), `withToolWhitelist(set, fn)`, `currentToolWhitelist()`. Per-fork isolation; paralelo de 2 forks não corrompe state.
2. **`internal/runtime/fork-agent.ts`** (NOVO) — `forkAgent(parent, options)` retorna `ForkResult { result, toolCalls, usage }`. Inherits parent.options (apiKey, model, provider, baseUrl, systemPrompt **byte-identical**) e roda dentro de `withToolWhitelist`. Auto-deny approval (não pausa para user). Memory write provenance via `metadata.forkOrigin`.
3. **`internal/judge/judge-call.ts`** (NOVO) — `judgeCall(ctx, opts)` instancia auxiliary agent (default `openai/gpt-4o-mini`, `temperature: 0`, `maxIterations: 1`, `tools: []`); retorna `JudgeResult { verdict, reason, parseFailed }`.
4. **`internal/judge/parse-verdict.ts`** (NOVO) — `parseVerdict(text)` puro (parseable em ≤5ms); strict prefix matching `DONE:`, `CONTINUE:`, `SKIPPED:`; fail-safe = `continue` com `parseFailed: true`.
5. **`internal/judge/verify-side-effect.ts`** (NOVO) — `verifyClaim<T>(claims, oracle)` para hallucination gate. Genérico sobre `(id: T) => Promise<boolean>`. Retorna `{ verified: T[]; phantom: T[] }`.
6. **`types/goal-events.ts`** (NOVO) — `GoalEvent` discriminated union (5 types: `turn_start`, `agent_response`, `judge_verdict`, `continuation`, `status_change`). `GoalResult` return value (status + turnsUsed + finalResponse).
7. **`internal/runtime/run-until.ts`** (NOVO) — `runUntilImpl(agent, goal, options)` AsyncGenerator. AbortSignal integration via flag check inside loop. `pauseGoal()` flips internal flag; loop verifica em cada turn boundary.
8. **`Agent.runUntil(goal, options?)` instance method** — adicionado em `SDKAgent` interface + `LocalAgent` + `CloudAgent` (cloud throws `UnsupportedRunOperationError` — cloud runtime gerencia loop server-side).
9. **Tool dispatch wiring** — `internal/agent-loop/tool-dispatch.ts:dispatchSingleCall` consulta `currentToolWhitelist()` **logo após repair** (linha 66-67) e antes de `tools.find`. Tool fora do whitelist retorna `tool_result` com `isError: false, content: "Tool X not available in this fork context"` (mimics D101 veto pattern).
10. **CI gates** — adversarial property tests via `fast-check` (≥600 runs) cobrindo (a) parseVerdict roundtrip — qualquer string que comece com `DONE:`/`CONTINUE:`/`SKIPPED:` parsea corretamente; (b) reason extraction preserva sufixo; (c) malformed input sempre retorna `parseFailed: true`; (d) AsyncLocalStorage isolation — 10 forks paralelos têm whitelists independentes.
11. **CI lint gate** — `tests/lint/no-global-tool-whitelist.test.ts` (regex grep) — `let.*_toolWhitelist|const _whitelist =|module.*whitelist` em production code = FAIL. Garante que ninguém regrida para global mutable.
12. **Example** — `examples/run-until-goal/` (NOVO): `for await (const event of agent.runUntil("ensure README has a Contributing section"))` real-LLM. Demo `pauseGoal()` mid-stream via AbortController.
13. **Telegram-pro probe novo** — `/goal <prompt>` (mode subcomando) drives `runUntil` loop com judge model = `openai/gpt-4o-mini` fixed; dogfood **30/30 PASS** (29 atuais + 1 novo).
14. **Roadmap update** — CLAUDE.md: Background work 3/3 ✅; totais **19 → 22 (96%)** DONE; Tier 4 parcial fechado (resta cross-session FTS5 + no_agent cron + dialectic + checkpoints v2 — fora deste plano).
15. **Zero regressão** em unit tests (853/853 atual → 920+ esperado).

## ADRs

| ID | Decisão | Rationale | Consequências |
|---|---|---|---|
| **D110** | `internal/runtime/fork-agent.ts` é o **home canonical** para o fork primitive; expõe `Agent.fork(options)` no `SDKAgent` shorthand instance method | Hermes ships `_spawn_background_review` direto em `run_agent.py`; SDK ganha modularidade colocando em `internal/runtime/` (vizinho de `local-agent.ts`, mesmo dominio). Shorthand `agent.fork(opts)` esconde construção via `Agent.create` interna | Enables: fork é primitive reusável (curator, kanban worker, judge runner). Constrains: parent precisa expor accessor para `apiKey`/`systemPrompt` (added defensively read-only) |
| **D111** | **Tool whitelist via `AsyncLocalStorage<Set<string>>`** — NUNCA global mutable | Python Hermes usa `threading.local()`. TS sem true threads, mas tem `AsyncLocalStorage` que propaga por async chain. Global `let _whitelist: Set<string> \| null` corromperia state entre 2 forks paralelos. CI lint gate previne regression | Enables: paralelo de N forks com whitelists independentes. Constrains: tool-dispatch precisa de `currentToolWhitelist()` import; +1 import line por arquivo de dispatch |
| **D112** | **Byte-identical system prompt inheritance** — fork.systemPrompt === parent.systemPrompt | Hermes mede 26% economia (Sonnet 4.5, issue #25322). System prompt diff invalida cache prefix; fork paga full price. SDK inherits via `parent.options.systemPrompt` direto (sem template re-rendering) | Enables: fork roda com cache hit. Constrains: caller que QUER override aceita cache miss explícito — documentado no JSDoc |
| **D113** | **Auto-deny approval** dentro de `withToolWhitelist` context | Background fork não pode pausar para user approval (Hermes issue #15216 TUI deadlock). Fork em context: hook `pre_tool_call` com `requires_approval: true` auto-denies. Approval em fork é categórico veto, não a pergunta | Enables: fork não trava. Constrains: tools que requerem approval (e.g., `shell` com `rm -rf`) simplesmente não rodam no fork — desejável; fork DEVE ter scope reduzido |
| **D114** | **Memory write provenance** via `metadata.forkOrigin: string` no AgentOptions | Hermes' `_memory_write_origin = "background_review"`. User vê depois "These memories created by fork(curator)" e pode undo seletivo sem afetar user-confirmed writes. SDK adds opcional `metadata.forkOrigin` no AgentOptions; memory layer propaga | Enables: fork-aware memory ops. Constrains: callers precisam set explicitamente — feature opt-in |
| **D115** | `GoalEvent` é **discriminated union por `type`**, NÃO generic event | Same rationale de `StreamObjectEvent` (D39 já decidiu). 5 types: `turn_start`, `agent_response`, `judge_verdict`, `continuation`, `status_change`. Exhaustiveness via TS switch. Adding novo type requer adicionar à union (não é silent extension) | Enables: type-safe consumer code, exhaustiveness check. Constrains: adicionar 6° type = quebra de TS exhaustive consumer — documentado como semver minor |
| **D116** | `Agent.runUntil` retorna `AsyncGenerator<GoalEvent, GoalResult>` (not `AsyncIterable<GoalEvent>`) | `AsyncGenerator<TYield, TReturn>` é typed para "evento por evento + result final". Consumer que quer só events: `for-await` (return value descartado). Consumer que quer result: manual `next()` loop. Same shape de Python's hermes' yield+return | Enables: dual usage pattern (event-by-event OR final-result). Constrains: `for-await` perde o return value (TS limitation); JSDoc documenta `agent.runUntil(goal).next()` para acesso |
| **D117** | **`AbortSignal` integration** — abort = generator yields `status_change paused` then returns | Idiomatic JS. Caller passa `signal: controller.signal`; controller.abort() — loop check no início de cada turn boundary. Generator's `finally` block roda → cleanup. Não usa custom event listener (raro em modern TS) | Enables: cancellation idiomatic. Constrains: aborts apenas em turn boundaries (not mid-tool-call) — documentado |
| **D118** | **`pauseGoal()` / `clearGoal()` controls** são instance methods no SDKAgent, NÃO global function | Hermes' `goals.py` tem state global por process; SDK não pode — múltiplos agents na mesma session. Per-agent state via private `Map<runUntilId, controller>`. `pauseGoal(id?)` defaults para currently active goal | Enables: multi-goal isolation. Constrains: id parameter raramente necessário — caller normalmente tem 1 goal ativa por agent |
| **D119** | **Judge model default = `openai/gpt-4o-mini` via `OPENROUTER_API_KEY`** (single env source, override via options.judgeApiKey + options.judgeModel) | Single source of truth = `.env` `OPENROUTER_API_KEY` (already authorized for telegram-pro + examples — see `feedback_env_file_allowed`). Não tentamos detectar Anthropic/OpenAI fallbacks — complexity sem benefit. Caller que quer Claude Haiku passa `judgeApiKey + judgeModel: "anthropic/claude-haiku-3-5"`. Default model `openai/gpt-4o-mini` é 1/30 do custo de GPT-4, fast turnaround, universalmente disponível via OpenRouter (EC-A fix) | Enables: judge funciona out-of-box em qualquer ambiente com OpenRouter key (Ralph dev environment). Constrains: ambientes só-Anthropic/só-OpenAI precisam passar explicitamente `judgeApiKey` — documentado no JSDoc |
| **D120** | **Verdict é enum `DONE/CONTINUE/SKIPPED`** (3 valores), NÃO free-form | Forces consistency. Parse-fail detector counts on enum shape. SKIPPED para "goal não é aplicável" (e.g., já estava feito) — útil para auto-skip de subgoals | Enables: TS exhaustive switch. Constrains: adicionar 4° verdict = breaking change para consumer |
| **D121** | **Fail-safe `continue` on parse error** + **max consecutive cap (default 3)** | Stopping prematurely é pior que burning extra turns (user perde work-in-progress vs queima budget). Max cap previne weak-model infinite loop. 3 é gentle — random parse hiccup não bail; 3 em fila = signal | Enables: graceful degradation com weak judge models. Constrains: max-cap escolhido empiricamente — Hermes usa 3 |
| **D122** | **`runUntil` em CloudAgent → `UnsupportedRunOperationError`** | Cloud runtime gerencia loop server-side (não expõe per-turn control). Pattern usado também em `downloadArtifact` (D5). Local runtime é a primary tested path para Ralph loop; cloud GA decision separada | Enables: API consistency entre local + cloud. Constrains: cloud users precisam migrar para local-first ou esperar PaaS GA. Documentado em docs.md |

## Dependency Graph

```
Phase 0 (audit) ──┬──▶ Phase 1 (AsyncLocalStorage + fork-agent)
                  │
                  ├──▶ Phase 2 (judge: parse + judgeCall + verify)
                  │
                  └──▶ Phase 3 (GoalEvent + run-until)
                              │
                              ▼
                  Phase 4 (wire: tool-dispatch whitelist + Agent.runUntil + Agent.fork)
                              │
                              ▼
                  Phase 5 (CI gates + adversarial fast-check + example runUntil)
                              │
                              ▼
                  Phase 6 (docs + 13 ADRs + CHANGELOG + CLAUDE.md roadmap)
                              │
                              ▼
                  Phase 7 (Final Dogfood QA — telegram-pro 30/30 com /goal probe)
```

- **Phase 1, 2, 3 são paralelizáveis** após Phase 0 (sem cross-deps; 3 módulos novos independentes).
- **Phase 4 bloqueia em 1+2+3** (precisa de todos os módulos para wirar).
- **Phase 5 → Phase 6 → Phase 7** sequenciais.

---

## Phase 0: Foundation — Audit & Inventory

**Objective:** Inventário fechado de (a) callers atuais que serão refatorados em Phase 4, (b) accessor surface preciso para fork inheritance, (c) sites de tool-dispatch onde whitelist check entra.

### T0.1 — Audit accessor surface + tool-dispatch sites

#### Objective
Lista exaustiva de: (a) campos de `AgentOptions` que fork precisa herdar; (b) site único onde whitelist check entra em `tool-dispatch.ts`; (c) lugares onde judge auxiliary agent pode ser instanciado sem conflito.

#### Evidence
`packages/sdk/src/internal/runtime/local-agent.ts:71` — `private readonly options: AgentOptions`. Fork lê `this.options.apiKey`, `model`, `systemPrompt`, `local.cwd`. Tool-dispatch site único em `internal/agent-loop/tool-dispatch.ts:dispatchSingleCall` linhas 67-103.

#### Files to edit
```
.claude/knowledge-base/plans/background-work-block-completion-plan.md — append inventory tabela
```

#### Deep file dependency analysis
- Pura análise. Saída anexa como Coverage Matrix.

#### Tasks
1. `grep -rn "this.options\." packages/sdk/src/internal/runtime/local-agent.ts | head -20`
2. `grep -rn "dispatchSingleCall\|tools.find\|resolved" packages/sdk/src/internal/agent-loop/`
3. Documentar lista em comentário do plano.
4. Confirmar que fork pode usar `Agent.create({ ...parentOpts, agentId: undefined, plugins: undefined })` sem violar D108 (V1.2 caller API).

#### TDD
```
N/A — audit puro.
GREEN: inventory documentado.
VERIFY: outro engenheiro reproduz via grep.
```

#### Acceptance Criteria
- [ ] 3 listas (parent accessor surface, tool-dispatch single site, judge instance config) documentadas
- [ ] 0 sites ambíguos

#### DoD
- [ ] Inventory revisado + plano atualizado

---

## Phase 1: Fork Agent — AsyncLocalStorage + forkAgent + checkToolWhitelist

**Objective:** Entregar `internal/runtime/async-local-storage.ts` + `internal/runtime/fork-agent.ts`. Per-fork isolation, byte-identical systemPrompt, auto-deny approval, memory provenance.

### T1.1 — Criar `internal/runtime/async-local-storage.ts`

#### Objective
Per-fork tool whitelist store via Node's `node:async_hooks.AsyncLocalStorage`. API minima: `withToolWhitelist(set, fn)` runs `fn` dentro do ALS context; `currentToolWhitelist()` retorna `Set<string> | undefined`.

#### Evidence
- `forked-agent-pattern.md:99-150` — TS canonical: `const toolWhitelistStore = new AsyncLocalStorage<Set<string>>()`.
- ADR D111 (AsyncLocalStorage não global).

#### Files to edit
```
packages/sdk/src/internal/runtime/async-local-storage.ts (NEW)
```

#### Deep file dependency analysis
- `async-local-storage.ts` (NEW) — leaf, import `AsyncLocalStorage` from `node:async_hooks`. Zero deps internos.

#### Deep Dives
**API final:**
```typescript
import { AsyncLocalStorage } from "node:async_hooks";

const toolWhitelistStore = new AsyncLocalStorage<Set<string>>();

export async function withToolWhitelist<T>(
  whitelist: Set<string>,
  fn: () => Promise<T>,
): Promise<T> {
  return toolWhitelistStore.run(whitelist, fn);
}

export function currentToolWhitelist(): Set<string> | undefined {
  return toolWhitelistStore.getStore();
}

/** Result of `checkToolWhitelist`. */
export interface ToolWhitelistDecision {
  allowed: boolean;
  /** Set when allowed === false. */
  reason?: string;
}

export function checkToolWhitelist(toolName: string): ToolWhitelistDecision {
  const whitelist = currentToolWhitelist();
  if (whitelist === undefined) return { allowed: true }; // not in fork context
  if (!whitelist.has(toolName)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" not available in this fork context`,
    };
  }
  return { allowed: true };
}
```

**Invariantes:**
- `currentToolWhitelist()` retorna `undefined` fora de `withToolWhitelist` (parent agent não tem whitelist).
- `withToolWhitelist` é async-context-aware — paralelo de 2 calls com sets diferentes não corrompe state um do outro.
- `checkToolWhitelist` é pure read — não mutate state.

**Edge cases:**
- **EC-1**: chamadas aninhadas (`withToolWhitelist(A, () => withToolWhitelist(B, ...))`)? Inner shadowing — store retorna B. Documentado.
- **EC-2**: parent agent (sem ALS context) chama tool → `checkToolWhitelist` retorna `{ allowed: true }`. Backward compat.

#### Tasks
1. Criar `internal/runtime/async-local-storage.ts` per spec.
2. Testes em `tests/internal/runtime/async-local-storage.test.ts`.

#### TDD
```
RED:     test_current_whitelist_undefined_outside_context()    — sem with, retorna undefined
RED:     test_with_whitelist_set_visible_inside()              — dentro de with, store.getStore() === set
RED:     test_parallel_forks_have_independent_whitelists()     — Promise.all([with(A), with(B)]) — A não vê B
RED:     test_check_tool_outside_context_allows_all()          — undefined whitelist → allowed
RED:     test_check_tool_inside_context_filters()              — { allowed: false, reason: "..." }
RED:     test_nested_with_inner_shadows_outer()                — with(A, () => with(B, () => current)) === B
GREEN:   Implementar
REFACTOR: None
VERIFY:  cd packages/sdk && pnpm vitest run tests/internal/runtime/async-local-storage.test.ts
```

#### Acceptance Criteria
- [ ] 6 testes RED → GREEN
- [ ] `currentToolWhitelist`/`checkToolWhitelist` puros (no side effects)
- [ ] Zero biome warnings
- [ ] Cobertura ≥95%

#### DoD
- [ ] `pnpm typecheck` + `pnpm vitest` clean
- [ ] CHANGELOG `[Unreleased]` Added entry

---

### T1.2 — Criar `internal/runtime/fork-agent.ts`

#### Objective
`forkAgent(parent, options)` — instancia novo `SDKAgent` herdando parent.options (apiKey/model/provider/baseUrl/systemPrompt byte-identical, ADR D112), roda dentro de `withToolWhitelist(options.allowedTools)`, retorna `ForkResult`.

#### Evidence
- `forked-agent-pattern.md:101-150` — TS canonical.
- ADRs D110, D112, D113, D114.

#### Files to edit
```
packages/sdk/src/internal/runtime/fork-agent.ts (NEW)
packages/sdk/src/types/agent.ts — add metadata.forkOrigin field opcional
```

#### Deep file dependency analysis
- `fork-agent.ts` (NEW) — depends on `async-local-storage.ts` + `Agent` (forward via deps injection).
- `types/agent.ts` — adicionar `metadata?: { forkOrigin?: string }` ao `AgentOptions`. Backward compat (optional).

#### Deep Dives
**API final:**
```typescript
export interface ForkOptions {
  /** Tool subset visible to the fork. Tools not in this set return a "not available in fork" tool_result. */
  allowedTools: Set<string>;
  /** User prompt sent to the fork. Required — fork is task-driven. */
  prompt: string;
  /** Override system prompt. Default: byte-identical to parent (cache hit). */
  systemPrompt?: string;
  /** Max iterations cap. Default 16 (Hermes parity). */
  maxIterations?: number;
  /** Tag for memory writes attribution (ADR D114). Default `"fork"`. */
  forkOrigin?: string;
}

export interface ForkResult {
  /** Final result string (last agent response). */
  result: string | undefined;
  /** Tool calls executed within the fork. */
  toolCalls: ReadonlyArray<{ name: string; input: Record<string, unknown> }>;
  /** Token usage. */
  usage: { inputTokens: number; outputTokens: number };
}

interface ForkDeps {
  /** Inject Agent.create to avoid circular import. */
  create: (options: AgentOptions) => Promise<SDKAgent>;
}

export async function forkAgentImpl(
  parent: SDKAgent & { readonly options: AgentOptions },
  options: ForkOptions,
  deps: ForkDeps,
): Promise<ForkResult> {
  const parentOptions = parent.options;
  // EC-B fix: preserve memory plugins (kind: "memory") so fork can write
  // memory with provenance per D114. Drop general/model-provider plugins
  // (they re-register in the fork's own PluginManager init, redundant).
  const memoryPlugins = filterMemoryPlugins(parentOptions.plugins as unknown);
  const forkOptions: AgentOptions = {
    ...parentOptions,
    // Strip fields that don't survive fork:
    agentId: undefined,                                       // fresh id
    plugins: memoryPlugins as unknown as AgentOptions["plugins"], // EC-B: keep memory only; cast bridges legacy metadata type to v1.3 runtime accept-list
    skills: undefined,                                        // fork doesn't auto-load skill metadata
    // Override:
    maxIterations: options.maxIterations ?? 16,
    systemPrompt: options.systemPrompt ?? parentOptions.systemPrompt, // byte-identical
    metadata: {
      ...(parentOptions.metadata ?? {}),
      forkOrigin: options.forkOrigin ?? "fork",
      parentAgentId: parent.agentId,
    },
  };

  const fork = await deps.create(forkOptions);
  try {
    return await withToolWhitelist(options.allowedTools, async () => {
      const run = await fork.send(options.prompt);
      const result = await run.wait();
      return {
        result: result.result ?? undefined,
        toolCalls: extractToolCalls(result),
        usage: extractUsage(result),
      };
    });
  } finally {
    await fork.dispose();
  }
}
```

**Helper (matches existing `extractCodePlugins` `unknown` accept pattern):**
```typescript
// internal/runtime/fork-agent.ts
import { isCodePlugin } from "./local-agent-plugins.js";
import type { Plugin } from "../plugins/types.js";

function filterMemoryPlugins(
  plugins: unknown,
): Array<Extract<Plugin, { kind: "memory" }>> | undefined {
  if (!Array.isArray(plugins)) return undefined;
  const memoryOnly = plugins.filter(
    (p): p is Extract<Plugin, { kind: "memory" }> =>
      isCodePlugin(p) && p.kind === "memory",
  );
  return memoryOnly.length > 0 ? memoryOnly : undefined;
}
```
(Casts to `unknown` first because `AgentOptions.plugins` is declared as `PluginsSettings` metadata; v1.3 runtime accepts either via `extractCodePlugins(unknown)`.)

**Invariantes:**
- `fork.options.systemPrompt === parent.options.systemPrompt` (byte-identical, cache hit per ADR D112).
- `withToolWhitelist` wrapping garante per-fork isolation (ADR D111).
- Fork sempre disposed em finally (cleanup garantido).
- Memory plugins (kind: "memory") preservados; general + model-provider plugins drop (EC-B fix).

**Edge cases:**
- **EC-3**: `allowedTools` vazio (Set vazia)? Fork não consegue invocar nenhuma tool — válido para "no-tool" judge-like fork.
- **EC-4**: parent disposed mid-fork? `fork.send` propaga erro; finally dispose roda sem hang.
- **EC-5**: 2 forks paralelos com `forkOrigin` igual? Memory provenance ambígua — documentado como user responsibility. Sugere uuid.
- **EC-B (FIXED)**: Memory plugins (D98 `kind: "memory"`) sobrevivem ao fork — caso contrário fork não consegue escrever memory com provenance (D114 inerte).
- **EC-H (DOCUMENT)**: `allowedTools` matching é case-sensitive contra nomes JÁ repaired (lowercase canonical). Use canonical lowercase names.

#### Tasks
1. Criar `internal/runtime/fork-agent.ts`.
2. Adicionar `metadata.forkOrigin` field em `types/agent.ts`.
3. Adicionar accessor `readonly options: AgentOptions` em `LocalAgent` (já existe como private — expose como `get options()`).
4. Testes em `tests/internal/runtime/fork-agent.test.ts`.

#### TDD
```
RED:     test_fork_inherits_system_prompt_byte_identical()   — fork.options.systemPrompt === parent
RED:     test_fork_uses_independent_agent_id()                — fork.agentId !== parent.agentId
RED:     test_fork_allowed_tools_visible_inside()             — currentToolWhitelist() === set durante fork.send
RED:     test_fork_disposes_even_on_error()                   — finally roda
RED:     test_fork_metadata_origin_set()                      — fork.options.metadata.forkOrigin === "review"
RED:     test_parallel_forks_independent()                    — Promise.all 2 forks com whitelists diferentes
RED:     test_fork_preserves_memory_plugins_drops_others()    — EC-B: kind:"memory" survives; general/model-provider dropped
GREEN:   Implementar + filterMemoryPlugins helper
REFACTOR: extrair helpers `extractToolCalls`, `extractUsage`, `filterMemoryPlugins`
VERIFY:  pnpm vitest run tests/internal/runtime/fork-agent.test.ts
```

#### Acceptance Criteria
- [ ] 6 testes RED → GREEN
- [ ] Coverage ≥90%
- [ ] Zero biome warnings
- [ ] G8 (file ≤400 LoC) cumprido

#### DoD
- [ ] `pnpm typecheck` + `pnpm vitest` clean
- [ ] CHANGELOG `[Unreleased]` Added entry

---

## Phase 2: Judge — parseVerdict + judgeCall + verifyClaim

**Objective:** Entregar `internal/judge/` com 3 módulos pure-function. parseVerdict é determinístico; judgeCall instancia auxiliary agent; verifyClaim é side-effect oracle generic.

### T2.1 — Criar `internal/judge/parse-verdict.ts`

#### Objective
Pure-function parser. Strict prefix matching `DONE:`, `CONTINUE:`, `SKIPPED:`. Fail-safe = `{ verdict: "continue", parseFailed: true }`. Reason extraction preserva sufixo.

#### Evidence
- `judge-call-pattern.md:154-173` — TS canonical.
- ADRs D120 (enum), D121 (fail-safe).

#### Files to edit
```
packages/sdk/src/internal/judge/parse-verdict.ts (NEW)
packages/sdk/src/internal/judge/types.ts (NEW)
```

#### Deep file dependency analysis
- `parse-verdict.ts` (NEW) — leaf. Zero deps.
- `types.ts` (NEW) — `Verdict` enum, `JudgeResult` interface.

#### Deep Dives
**API final:**
```typescript
// types.ts
export type Verdict = "done" | "continue" | "skipped";
export interface JudgeResult {
  verdict: Verdict;
  reason: string;
  parseFailed: boolean;
}

// parse-verdict.ts
export function parseVerdict(text: string): JudgeResult {
  const trimmed = text.trim();
  if (trimmed.startsWith("DONE:")) {
    return { verdict: "done", reason: trimmed.slice(5).trim(), parseFailed: false };
  }
  if (trimmed.startsWith("CONTINUE:")) {
    return { verdict: "continue", reason: trimmed.slice(9).trim(), parseFailed: false };
  }
  if (trimmed.startsWith("SKIPPED:")) {
    return { verdict: "skipped", reason: trimmed.slice(8).trim(), parseFailed: false };
  }
  return {
    verdict: "continue", // fail-safe
    reason: `judge response malformed: "${trimmed.slice(0, 100)}"`,
    parseFailed: true,
  };
}
```

**Edge cases:**
- **EC-6**: Texto vazio `""` → `parseFailed: true` (reason: malformed).
- **EC-7**: Trailing whitespace `"DONE: foo  "` → reason "foo" (trim aplicado no slice).
- **EC-8**: Case-mismatch `"done: foo"` → `parseFailed: true` (strict). Defensible — judge model deve respeitar exact spec.
- **EC-9**: Múltiplos colons `"DONE: x: y"` → reason "x: y" (slice(5) preserva o resto).

#### Tasks
1. Criar `internal/judge/types.ts`.
2. Criar `internal/judge/parse-verdict.ts`.
3. Testes em `tests/internal/judge/parse-verdict.test.ts`.

#### TDD
```
RED:     test_parse_done_returns_verdict_done()
RED:     test_parse_continue_returns_verdict_continue()
RED:     test_parse_skipped_returns_verdict_skipped()
RED:     test_parse_reason_extracted_trimmed()
RED:     test_parse_malformed_returns_parse_failed()
RED:     test_parse_empty_string_returns_parse_failed()
RED:     test_parse_case_sensitive_strict()
RED:     test_parse_multi_colon_preserves_suffix()
RED:     test_parse_leading_bom_returns_parse_failed()  — EC-E: ﻿/​ prefix is not trimmed by .trim()
GREEN:   Implementar
REFACTOR: None
VERIFY:  pnpm vitest run tests/internal/judge/parse-verdict.test.ts
```

#### Acceptance Criteria
- [ ] 8 testes RED → GREEN
- [ ] Cobertura 100% (função pura, totalmente coberta por unit tests)
- [ ] Zero biome warnings

#### DoD
- [ ] `pnpm typecheck` clean
- [ ] CHANGELOG entry

---

### T2.2 — Criar `internal/judge/judge-call.ts`

#### Objective
`judgeCall(ctx, options?)` instancia auxiliary agent com judge model (default `openai/gpt-4o-mini` per D119), `temperature: 0` (D120 hardcoded mandatory), `maxIterations: 1`, `tools: []`. Retorna `JudgeResult`.

#### Evidence
- `judge-call-pattern.md:104-152` — TS canonical.
- ADR D119 (default judge model).

#### Files to edit
```
packages/sdk/src/internal/judge/judge-call.ts (NEW)
```

#### Deep file dependency analysis
- `judge-call.ts` (NEW) — depends on `parse-verdict.ts` + `Agent.create` (forward via deps).

#### Deep Dives
**API final:**
```typescript
export interface JudgeContext {
  goal: string;
  lastResponse: string;
  subgoals?: string[];
}

export interface JudgeOptions {
  judgeModel?: string;        // default "openai/gpt-4o-mini"
  apiKey?: string;            // default process.env.OPENROUTER_API_KEY (single source — EC-A)
  maxTokens?: number;         // default 200
}

interface JudgeDeps {
  create: (options: AgentOptions) => Promise<SDKAgent>;
}

export async function judgeCallImpl(
  ctx: JudgeContext,
  options: JudgeOptions | undefined,
  deps: JudgeDeps,
): Promise<JudgeResult> {
  const prompt = composeJudgePrompt(ctx);
  // EC-A: single env source — OpenRouter only. Caller passes `judgeApiKey`
  // explicitly for Anthropic/OpenAI direct. Auto-detecting providers
  // surprises callers — explicit override is simpler.
  const apiKey = options?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (apiKey === undefined) {
    return {
      verdict: "continue",
      reason: "judge unavailable: OPENROUTER_API_KEY missing and no override passed via options.judgeApiKey",
      parseFailed: true,
    };
  }

  const auxAgent = await deps.create({
    apiKey,
    model: { id: options?.judgeModel ?? "openai/gpt-4o-mini" },
    temperature: 0, // ADR D120 mandatory
    maxIterations: 1,
    tools: [],
    local: {}, // default cwd
    metadata: { forkOrigin: "judge" },
  });

  try {
    const run = await auxAgent.send(prompt);
    const result = await run.wait();
    return parseVerdict(result.result ?? "");
  } catch (err) {
    return {
      verdict: "continue",
      reason: `judge call failed: ${err instanceof Error ? err.message : String(err)}`,
      parseFailed: true,
    };
  } finally {
    await auxAgent.dispose();
  }
}

export function composeJudgePrompt(ctx: JudgeContext): string {
  const subgoals = ctx.subgoals?.length ? ctx.subgoals.join(", ") : "(none)";
  return `You are a goal judge. Determine if this goal is satisfied.

Goal: ${ctx.goal}
Subgoals: ${subgoals}
Last agent response: ${ctx.lastResponse}

Respond with EXACTLY one of:
- DONE: <reason>
- CONTINUE: <what's left>
- SKIPPED: <why not applicable>

Be strict. If unclear, prefer CONTINUE.`;
}
```

**Edge cases:**
- **EC-10**: Sem `OPENROUTER_API_KEY` no env e sem `options.apiKey` override → retorna fail-safe `continue` com explicit reason "OPENROUTER_API_KEY missing" (não throw). Caller sabe que judge não funcionou.
- **EC-11**: Auxiliary agent.send throws (network)? Catch em try/finally → returns fail-safe.
- **EC-12**: `temperature: 0` não é honored pelo provider? Hardcoded no code — provider que ignora produz menos determinismo; documentado.
- **EC-J (DOCUMENT)**: Judge aux agent dentro de `forkAgent` context herda whitelist via AsyncLocalStorage. Hoje OK porque judge tem `tools: []`; futuros callers que adicionarem tools ao judge devem saber. JSDoc na função alerta.

#### Tasks
1. Criar `internal/judge/judge-call.ts`.
2. Testes em `tests/internal/judge/judge-call.test.ts`.

#### TDD
```
RED:     test_judge_call_returns_done_when_response_starts_with_done()
RED:     test_judge_call_temperature_zero_in_agent_options()
RED:     test_judge_call_fails_safe_when_no_api_key()
RED:     test_judge_call_disposes_aux_agent_on_error()
RED:     test_compose_judge_prompt_includes_goal_and_response()
GREEN:   Implementar com fixture mode (instancia aux agent com fake key)
REFACTOR: None
VERIFY:  pnpm vitest run tests/internal/judge/judge-call.test.ts
```

#### Acceptance Criteria
- [ ] 5 testes RED → GREEN
- [ ] Cobertura ≥85% (judge runtime path inclui rede — fixture-mode test)
- [ ] Zero biome warnings

#### DoD
- [ ] `pnpm typecheck` clean
- [ ] CHANGELOG entry

---

### T2.3 — Criar `internal/judge/verify-side-effect.ts`

#### Objective
`verifyClaim<T>(claims, oracle)` genérico sobre `(id: T) => Promise<boolean>`. Retorna `{ verified: T[]; phantom: T[] }`. Para hallucination gates (kanban v0.13 #20232).

#### Evidence
- `judge-call-pattern.md:222-251` — TS canonical.

#### Files to edit
```
packages/sdk/src/internal/judge/verify-side-effect.ts (NEW)
```

#### Deep file dependency analysis
- `verify-side-effect.ts` (NEW) — leaf, generic helper.

#### Deep Dives
**API final:**
```typescript
export async function verifyClaim<T>(
  claims: ReadonlyArray<T>,
  oracle: (claim: T) => Promise<boolean>,
): Promise<{ verified: T[]; phantom: T[] }> {
  const verified: T[] = [];
  const phantom: T[] = [];
  for (const claim of claims) {
    if (await oracle(claim)) {
      verified.push(claim);
    } else {
      phantom.push(claim);
    }
  }
  return { verified, phantom };
}
```

**Edge cases:**
- **EC-13**: claims vazio → `{ verified: [], phantom: [] }`. OK.
- **EC-14**: oracle throws? Documenta como user responsibility (test cobrindo). Não swallow silently — re-throw.

#### Tasks
1. Criar `internal/judge/verify-side-effect.ts`.
2. Testes em `tests/internal/judge/verify-side-effect.test.ts`.

#### TDD
```
RED:     test_verify_empty_claims_returns_empty_buckets()
RED:     test_verify_all_truthful_oracle_returns_all_verified()
RED:     test_verify_partial_phantom_detection()
RED:     test_verify_oracle_throw_propagates()
GREEN:   Implementar
REFACTOR: None
VERIFY:  pnpm vitest run tests/internal/judge/verify-side-effect.test.ts
```

#### Acceptance Criteria
- [ ] 4 testes RED → GREEN
- [ ] Cobertura 100%
- [ ] Zero biome warnings

#### DoD
- [ ] CHANGELOG entry

---

## Phase 3: AsyncIterable runUntil — GoalEvent + run-until impl

**Objective:** Entregar `types/goal-events.ts` (discriminated union) + `internal/runtime/run-until.ts` (AsyncGenerator). `Agent.runUntil` adicionado em `SDKAgent` interface + `LocalAgent` (cloud throws per D122).

### T3.1 — Criar `types/goal-events.ts`

#### Objective
`GoalEvent` discriminated union (5 types) + `GoalResult` return value type. `GoalOptions` para configuração externa.

#### Evidence
- `async-iterable-streaming.md:36-44` — TS canonical.
- ADRs D115 (discriminated union), D116 (AsyncGenerator), D118 (control methods).

#### Files to edit
```
packages/sdk/src/types/goal-events.ts (NEW)
```

#### Deep file dependency analysis
- `goal-events.ts` (NEW) — leaf, type-only.

#### Deep Dives
**API final:**
```typescript
export type GoalEvent =
  | { type: "turn_start"; turn: number; goal: string }
  | { type: "agent_response"; turn: number; content: string }
  | {
      type: "judge_verdict";
      turn: number;
      verdict: "done" | "continue" | "skipped";
      reason: string;
      parseFailed: boolean;
    }
  | { type: "continuation"; turn: number; prompt: string }
  | {
      type: "status_change";
      status: "active" | "paused" | "completed" | "failed";
      reason: string;
    };

export interface GoalResult {
  status: "completed" | "failed" | "paused";
  turnsUsed: number;
  finalResponse: string | undefined;
}

export interface GoalOptions {
  maxTurns?: number;                       // default 20
  maxConsecutiveJudgeFailures?: number;    // default 3 (ADR D121)
  judgeModel?: string;                     // default "openai/gpt-4o-mini"
  judgeApiKey?: string;
  subgoals?: string[];
  signal?: AbortSignal;
}
```

#### Tasks
1. Criar `types/goal-events.ts`.
2. Re-exportar em `packages/sdk/src/index.ts`.

#### TDD
```
RED:     test_goal_event_type_narrows_via_discriminator()  — type-test compile-check
GREEN:   Implementar types
REFACTOR: None
VERIFY:  pnpm typecheck
```

#### Acceptance Criteria
- [ ] Types exportados publicamente
- [ ] Zero biome warnings

#### DoD
- [ ] CHANGELOG entry

---

### T3.2 — Criar `internal/runtime/run-until.ts`

#### Objective
`runUntilImpl(agent, goal, options, deps)` é AsyncGenerator. Loop: turn_start → send → agent_response → judge_verdict → (done? return : continuation → next turn). AbortSignal check no início de cada turn boundary. Max consecutive judge failures bail.

#### Evidence
- `async-iterable-streaming.md:48-110` — TS canonical.
- `judge-call-pattern.md:184-217` — consecutive failure detection.
- ADRs D116 (AsyncGenerator), D117 (AbortSignal), D121 (max-cap).

#### Files to edit
```
packages/sdk/src/internal/runtime/run-until.ts (NEW)
```

#### Deep file dependency analysis
- `run-until.ts` (NEW) — depends on `judge-call.ts`, `goal-events.ts`. Imports `judgeCallImpl` + types.

#### Deep Dives
**API final:**
```typescript
interface RunUntilDeps {
  judge: (ctx: JudgeContext, opts?: JudgeOptions) => Promise<JudgeResult>;
}

export async function* runUntilImpl(
  agent: SDKAgent,
  goal: string,
  options: GoalOptions | undefined,
  deps: RunUntilDeps,
): AsyncGenerator<GoalEvent, GoalResult, void> {
  const maxTurns = options?.maxTurns ?? 20;
  const maxFails = options?.maxConsecutiveJudgeFailures ?? 3;
  const signal = options?.signal;
  let turn = 0;
  let consecutiveFailures = 0;
  let lastResponse = "";

  // EC-C fix: check signal BEFORE the first yield so a pre-aborted signal
  // emits only `[paused]`, not `[active, paused]`. Pre-aborted is the
  // common case when consumer wires `controller.abort()` from a sibling
  // timeout that fired before the loop started.
  if (signal?.aborted === true) {
    yield { type: "status_change", status: "paused", reason: "aborted via AbortSignal before first turn" };
    return { status: "paused", turnsUsed: 0, finalResponse: undefined };
  }

  yield { type: "status_change", status: "active", reason: "Goal started" };

  try {
    while (turn < maxTurns) {
      if (signal?.aborted === true) {
        yield { type: "status_change", status: "paused", reason: "aborted via AbortSignal" };
        return { status: "paused", turnsUsed: turn, finalResponse: lastResponse };
      }

      turn += 1;
      yield { type: "turn_start", turn, goal };

      const continuationPrompt =
        turn === 1 ? goal : composeContinuation(goal, lastResponse);

      const run = await agent.send(continuationPrompt);
      const result = await run.wait();
      lastResponse = result.result ?? "";
      yield { type: "agent_response", turn, content: lastResponse };

      const judgment = await deps.judge(
        { goal, lastResponse, subgoals: options?.subgoals },
        {
          judgeModel: options?.judgeModel,
          ...(options?.judgeApiKey !== undefined ? { apiKey: options.judgeApiKey } : {}),
        },
      );
      yield {
        type: "judge_verdict",
        turn,
        verdict: judgment.verdict,
        reason: judgment.reason,
        parseFailed: judgment.parseFailed,
      };

      if (judgment.parseFailed) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= maxFails) {
          yield {
            type: "status_change",
            status: "failed",
            reason: `judge model too unreliable (${consecutiveFailures} parse failures in a row)`,
          };
          return { status: "failed", turnsUsed: turn, finalResponse: lastResponse };
        }
      } else {
        consecutiveFailures = 0;
      }

      if (judgment.verdict === "done") {
        yield { type: "status_change", status: "completed", reason: judgment.reason };
        return { status: "completed", turnsUsed: turn, finalResponse: lastResponse };
      }
      if (judgment.verdict === "skipped") {
        yield {
          type: "status_change",
          status: "completed",
          reason: `skipped: ${judgment.reason}`,
        };
        return { status: "completed", turnsUsed: turn, finalResponse: lastResponse };
      }

      // continue
      yield { type: "continuation", turn, prompt: continuationPrompt };
    }

    yield {
      type: "status_change",
      status: "failed",
      reason: `max turns (${maxTurns}) exhausted`,
    };
    return { status: "failed", turnsUsed: turn, finalResponse: lastResponse };
  } finally {
    // Cleanup hook for future state (currently no-op; documented for fork integration)
  }
}

function composeContinuation(goal: string, lastResponse: string): string {
  return `Continue working toward the goal: ${goal}\n\nYour last response was:\n${lastResponse.slice(0, 1000)}`;
}
```

**Invariantes:**
- Generator yields exactly 1 `status_change: active` no início e 1 `status_change: (completed|failed|paused)` no fim.
- `judgment.parseFailed: true` incrementa contador; sucesso reseta.
- AbortSignal check apenas no início de turn — não preempção mid-tool-call (D117).
- Return value sempre carrega `turnsUsed` e `finalResponse` accurate.

**Edge cases:**
- **EC-15**: maxTurns: 0 → yield `active` + yield `failed (max turns exhausted)`. Vacuously satisfied (now with explicit test via EC-D).
- **EC-16**: Consumer break dentro do for-await → generator's finally roda (D116 cleanup contract).
- **EC-17**: agent.send throws → unhandled, propaga para consumer's try/catch (idiomatic AsyncGenerator behavior).
- **EC-18 / EC-C (FIXED)**: signal aborted BEFORE first turn → yield `paused` only (no preceding `active`) + return imediato (turnsUsed: 0, finalResponse: undefined).
- **EC-I (DOCUMENT)**: Consumer chamando `agent.dispose()` mid-iteration → próximo `agent.send` throws → generator propaga ao consumer try/catch. Documentado no JSDoc da Agent.runUntil: "do not dispose during active iteration".

#### Tasks
1. Criar `internal/runtime/run-until.ts`.
2. Testes em `tests/internal/runtime/run-until.test.ts` usando agent + judge mockados.

#### TDD
```
RED:     test_run_until_yields_active_then_completed_on_done_verdict()
RED:     test_run_until_loops_continue_until_done()
RED:     test_run_until_bails_after_max_consecutive_judge_failures()
RED:     test_run_until_max_turns_exhausted_returns_failed()
RED:     test_run_until_skipped_verdict_completes_early()
RED:     test_run_until_abort_signal_pauses_immediately()
RED:     test_run_until_return_value_has_turns_used_and_final_response()
RED:     test_run_until_pre_aborted_signal_yields_paused_only()   — EC-C: no [active, paused], just [paused]
RED:     test_run_until_max_turns_zero_yields_active_then_failed() — EC-D: explicit max-0 coverage
GREEN:   Implementar
REFACTOR: extract composeContinuation
VERIFY:  pnpm vitest run tests/internal/runtime/run-until.test.ts
```

#### Acceptance Criteria
- [ ] 7 testes RED → GREEN
- [ ] Cobertura ≥90%
- [ ] G8 (file ≤400 LoC) cumprido
- [ ] Zero biome warnings

#### DoD
- [ ] `pnpm typecheck` + `pnpm vitest` clean
- [ ] CHANGELOG entry

---

## Phase 4: Wiring — Tool dispatch whitelist + Agent.runUntil + Agent.fork

**Objective:** Wirar os 3 módulos no agent path. Tool-dispatch consulta `checkToolWhitelist` antes de execute. `Agent.runUntil` adicionado ao SDKAgent + LocalAgent (CloudAgent throws). `Agent.fork` shorthand.

### T4.1 — Wirar `checkToolWhitelist` em tool-dispatch

#### Objective
`internal/agent-loop/tool-dispatch.ts:dispatchSingleCall` chama `checkToolWhitelist(call.name)` LOGO APÓS o repair (linha 66-67), ANTES de `tools.find`. Tool fora do whitelist retorna `tool_result` com `isError: false, content: "Tool X not available in fork context"`.

#### Evidence
- `tool-dispatch.ts:67-103` — site único atual.
- ADR D111 (AsyncLocalStorage).

#### Files to edit
```
packages/sdk/src/internal/agent-loop/tool-dispatch.ts — add whitelist check
```

#### Deep file dependency analysis
- `tool-dispatch.ts` — import `checkToolWhitelist` from `../runtime/async-local-storage.js`. Single inserção entre linha 66 e 67.

#### Deep Dives
**Wiring final (diff abstract):**
```typescript
// After repair, BEFORE tools.find:
const whitelistDecision = checkToolWhitelist(call.name);
if (!whitelistDecision.allowed) {
  events.push(buildToolUseRunning(inputs, callId, call));
  events.push(
    buildToolUseCompleted(inputs, callId, call, {
      stdout: "",
      stderr: whitelistDecision.reason ?? "tool not available in fork",
      exitCode: 126,
    }),
  );
  return {
    type: "tool_result",
    toolUseId: call.id,
    content: `Tool blocked by fork whitelist: ${whitelistDecision.reason}`,
  };
}
```

**Invariantes:**
- Whitelist check é a PRIMEIRA gate (antes de plugin veto, antes de file hook). Razão: se fork não tem permissão, nem chama plugin pre-tool hooks (não vaza intent).
- Block produz `tool_result` (não throw) — model recebe explanation, escolhe outra abordagem.

**Edge cases:**
- **EC-19**: Tool whitelist is `undefined` (parent agent) → `currentToolWhitelist()` returns undefined → `checkToolWhitelist` returns `allowed: true`. Backward compat.
- **EC-20**: Whitelist com tool name após repair (repaired case-insensitive)? Repair ALREADY happens above; checkToolWhitelist sees the canonical name.

#### Tasks
1. Adicionar import em `tool-dispatch.ts`.
2. Inserir whitelist check entre linha 66 (repair) e linha 67 (tools.find).
3. Testes em `tests/internal/agent-loop/tool-dispatch-whitelist.test.ts`.

#### TDD
```
RED:     test_tool_dispatch_blocks_when_outside_whitelist()
RED:     test_tool_dispatch_allows_when_inside_whitelist()
RED:     test_tool_dispatch_allows_when_no_whitelist_context()
RED:     test_tool_dispatch_whitelist_check_after_repair()
GREEN:   Wirar import + check
REFACTOR: None
VERIFY:  pnpm vitest run tests/internal/agent-loop/
```

#### Acceptance Criteria
- [ ] 4 testes RED → GREEN
- [ ] Zero regressão em testes existentes (853/853)
- [ ] G8 cumprido (tool-dispatch.ts ainda ≤400 LoC)

#### DoD
- [ ] `pnpm vitest` clean
- [ ] CHANGELOG entry

---

### T4.2 — Adicionar `Agent.runUntil` instance method em LocalAgent + interface

#### Objective
Add `runUntil(goal, options?)` ao `SDKAgent` interface (return `AsyncGenerator<GoalEvent, GoalResult, void>`). LocalAgent implements; CloudAgent throws `UnsupportedRunOperationError` (D122).

#### Evidence
- `async-iterable-streaming.md:344-350` — wire location.
- ADRs D116, D118, D122.

#### Files to edit
```
packages/sdk/src/types/agent.ts — add runUntil method to SDKAgent
packages/sdk/src/internal/runtime/local-agent.ts — implement
packages/sdk/src/internal/runtime/cloud-agent.ts — implement (throws)
packages/sdk/src/index.ts — export GoalEvent, GoalResult, GoalOptions
```

#### Deep file dependency analysis
- `SDKAgent` adquire `runUntil` method — semver minor (new optional public).
- `LocalAgent` ganha 5-10 LoC: import + delegate para `runUntilImpl`.
- `CloudAgent` ganha throw stub.

#### Deep Dives
**Wiring final em LocalAgent:**
```typescript
runUntil(
  goal: string,
  options?: GoalOptions,
): AsyncGenerator<GoalEvent, GoalResult, void> {
  const agent = this;
  async function* wrapper() {
    const { runUntilImpl } = await import("./run-until.js");
    const { judgeCallImpl } = await import("../judge/judge-call.js");
    const deps: RunUntilDeps = {
      judge: (ctx, opts) =>
        judgeCallImpl(ctx, opts, { create: (o) => Agent.create(o) }),
    };
    yield* runUntilImpl(agent, goal, options, deps);
  }
  return wrapper();
}
```

**Em CloudAgent (EC-G — throws sync apesar de return AsyncGenerator):**
```typescript
runUntil(): never {
  // EC-G: this throws synchronously despite the TS return type declaring
  // AsyncGenerator. Caller `for await (const e of agent.runUntil(...))`
  // receives the throw at the for-await statement itself, not as a yielded
  // error. JSDoc explicitly documents this for cloud agents.
  throw new UnsupportedRunOperationError(
    "Agent.runUntil() is not supported on cloud agents. " +
    "Cloud runtime manages goal loops server-side. " +
    "Use a local agent for autonomous Ralph loops.",
  );
}
```

**Invariantes:**
- `Agent.runUntil` é instance method (não static). Per-agent state (pauseGoal — futuro).
- `runUntilImpl` recebe `agent` argument — fork-safe (chama `agent.send`, não global).

#### Tasks
1. Adicionar `runUntil` ao `SDKAgent` interface.
2. Implementar em `LocalAgent`.
3. CloudAgent: throw `UnsupportedRunOperationError`.
4. Exportar types em `index.ts`.
5. Testes em `tests/agent-run-until.test.ts` (integration).

#### TDD
```
RED:     test_local_agent_run_until_yields_events_in_order()
RED:     test_local_agent_run_until_returns_goal_result()
RED:     test_cloud_agent_run_until_throws_unsupported()
GREEN:   Wirar
REFACTOR: None
VERIFY:  pnpm vitest run tests/agent-run-until.test.ts
```

#### Acceptance Criteria
- [ ] 3 testes RED → GREEN
- [ ] Zero regressão
- [ ] `Agent.runUntil` é re-exportado de index.ts

#### DoD
- [ ] CHANGELOG entry

---

### T4.3 — Adicionar `Agent.fork` shorthand instance method

#### Objective
`agent.fork(options)` é shorthand sobre `forkAgentImpl`. Adicionado opcional em `SDKAgent` interface; LocalAgent implements; CloudAgent throws (cloud não suporta fork).

#### Evidence
- `forked-agent-pattern.md:332-339` — wire location.
- ADR D110.

#### Files to edit
```
packages/sdk/src/types/agent.ts — add fork method to SDKAgent
packages/sdk/src/internal/runtime/local-agent.ts — implement
packages/sdk/src/internal/runtime/cloud-agent.ts — implement (throws)
```

#### Deep file dependency analysis
- LocalAgent precisa expose `readonly options: AgentOptions` getter (T1.2 já trata).

#### Deep Dives
**Wiring final em LocalAgent:**
```typescript
async fork(options: ForkOptions): Promise<ForkResult> {
  const { forkAgentImpl } = await import("./fork-agent.js");
  return forkAgentImpl(this, options, { create: (o) => Agent.create(o) });
}

get options(): AgentOptions {
  return this._options; // expose previously-private field
}
```

#### Tasks
1. Adicionar `fork` ao `SDKAgent` interface.
2. Implementar em `LocalAgent` + expose `options` getter.
3. CloudAgent: throws.
4. Testes em `tests/agent-fork.test.ts`.

#### TDD
```
RED:     test_local_agent_fork_inherits_system_prompt()
RED:     test_local_agent_fork_runs_with_whitelist()
RED:     test_local_agent_fork_disposes_fork_after()
RED:     test_cloud_agent_fork_throws_unsupported()
GREEN:   Wirar
REFACTOR: None
VERIFY:  pnpm vitest run tests/agent-fork.test.ts
```

#### Acceptance Criteria
- [ ] 4 testes RED → GREEN
- [ ] Zero regressão

#### DoD
- [ ] CHANGELOG entry

---

## Phase 5: CI gates + adversarial fast-check + example runUntil

**Objective:** Adversarial property tests via `fast-check` + CI lint gate + example real-LLM `examples/run-until-goal/`.

### T5.1 — Adversarial fast-check para parseVerdict + AsyncLocalStorage

#### Objective
Property tests com `fast-check` (≥600 runs total):
- parseVerdict: qualquer string que começa com `DONE:`/`CONTINUE:`/`SKIPPED:` parsea corretamente (200 runs cada = 600).
- parseVerdict: reason extraction preserva sufixo intact.
- AsyncLocalStorage: 10 forks paralelos têm whitelists independentes (sem cross-contamination).

#### Evidence
- `tests/internal/security/redact.property.test.ts` — template já existente no SDK.
- ADRs D120, D121 (parser semantics).

#### Files to edit
```
packages/sdk/tests/internal/judge/parse-verdict.property.test.ts (NEW)
packages/sdk/tests/internal/runtime/async-local-storage.property.test.ts (NEW)
```

#### Deep Dives
**parse-verdict.property.test.ts:**
```typescript
import { fc, test } from "@fast-check/vitest";
import { parseVerdict } from "../../../src/internal/judge/parse-verdict.js";

test.prop([fc.string({ minLength: 1, maxLength: 200 })])(
  "DONE: prefix always parses to verdict=done",
  (suffix) => {
    const result = parseVerdict(`DONE: ${suffix}`);
    expect(result.verdict).toBe("done");
    expect(result.parseFailed).toBe(false);
  },
);

test.prop([fc.string({ minLength: 1, maxLength: 200 })])(
  "CONTINUE: prefix always parses to verdict=continue",
  (suffix) => {
    const result = parseVerdict(`CONTINUE: ${suffix}`);
    expect(result.verdict).toBe("continue");
    expect(result.parseFailed).toBe(false);
  },
);

test.prop([fc.string({ minLength: 1, maxLength: 200 })])(
  "SKIPPED: prefix always parses to verdict=skipped",
  (suffix) => {
    const result = parseVerdict(`SKIPPED: ${suffix}`);
    expect(result.verdict).toBe("skipped");
    expect(result.parseFailed).toBe(false);
  },
);

test.prop([
  fc.string().filter((s) => !/^(DONE|CONTINUE|SKIPPED):/.test(s.trim())),
])("malformed input always sets parseFailed=true", (text) => {
  const result = parseVerdict(text);
  expect(result.parseFailed).toBe(true);
});
```

**async-local-storage.property.test.ts:**
```typescript
test.prop([fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 10 })])(
  "parallel forks have independent whitelists",
  async (toolNames) => {
    const sets = toolNames.map((n) => new Set([n]));
    const results = await Promise.all(
      sets.map((set) =>
        withToolWhitelist(set, async () => {
          await new Promise((r) => setTimeout(r, 1));
          return currentToolWhitelist();
        }),
      ),
    );
    for (let i = 0; i < sets.length; i += 1) {
      expect(results[i]).toBe(sets[i]); // each fork saw OWN set, byte-identical reference
    }
  },
);
```

#### Tasks
1. Criar 2 property test files.
2. Rodar `pnpm vitest run` + confirmar zero falhas.

#### TDD
```
RED:     N/A (testes property-based já testam invariantes existentes)
GREEN:   parseVerdict + AsyncLocalStorage já implementados — testes devem passar de cara
VERIFY:  pnpm vitest run tests/internal/judge/parse-verdict.property.test.ts tests/internal/runtime/async-local-storage.property.test.ts
```

#### Acceptance Criteria
- [ ] 4+ properties × 200 runs cada = ≥800 invariant assertions
- [ ] Zero falhas
- [ ] Cobertura adicional documentada

#### DoD
- [ ] CHANGELOG entry

---

### T5.2 — CI lint gate `no-global-tool-whitelist`

#### Objective
Regex grep test em `packages/sdk/src/` — qualquer `let.*_toolWhitelist|let.*_whitelist|module.*whitelist|export.*let.*whitelist` em production = FAIL. Previne regression para global mutable state.

#### Evidence
- `tests/lint/no-hardcoded-theokit-path.test.ts` — template existente.
- ADR D111.

#### Files to edit
```
packages/sdk/tests/lint/no-global-tool-whitelist.test.ts (NEW)
```

#### Deep Dives
**Test:**
```typescript
import { execSync } from "node:child_process";

it("packages/sdk/src/ has no global mutable tool whitelist", () => {
  const result = execSync(
    `grep -rn -E "let\\s+(_)?[Tt]ool[Ww]hitelist\\s*[:=]" packages/sdk/src/ || true`,
  ).toString().trim();
  expect(result).toBe("");
});

it("packages/sdk/src/ uses AsyncLocalStorage for tool whitelist", () => {
  const result = execSync(
    `grep -rn "AsyncLocalStorage" packages/sdk/src/internal/runtime/async-local-storage.ts`,
  ).toString().trim();
  expect(result).not.toBe("");
});
```

#### Tasks
1. Criar lint test.

#### TDD
```
RED:     test_no_global_mutable_whitelist_exists()  — passes if grep retorna vazio
GREEN:   Test passa após Phase 1 (AsyncLocalStorage é a única forma)
VERIFY:  pnpm vitest run tests/lint/no-global-tool-whitelist.test.ts
```

#### Acceptance Criteria
- [ ] Test pass

#### DoD
- [ ] CHANGELOG entry

---

### T5.3 — Example `examples/run-until-goal/`

#### Objective
Example real-LLM minimal: `for await (const event of agent.runUntil("ensure README has a Contributing section"))` + console.log dos events. Demonstra `pauseGoal` via AbortController após 30s.

#### Evidence
- `async-iterable-streaming.md:115-156` — consumption pattern canonical.
- Real-LLM rule (`real-llm-validation.md`).

#### Files to edit
```
examples/run-until-goal/package.json (NEW)
examples/run-until-goal/index.ts (NEW)
examples/run-until-goal/README.md (NEW)
```

#### Deep Dives
**index.ts:**
```typescript
import { Agent } from "@usetheo/sdk";

const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: { id: "openai/gpt-4o-mini" },
  local: {},
  systemPrompt: "You are a helpful coder. Read the README, propose a Contributing section, and stop when satisfied.",
});

const controller = new AbortController();
setTimeout(() => {
  console.log("[abort] 30s elapsed, pausing goal...");
  controller.abort();
}, 30_000);

try {
  for await (const event of agent.runUntil(
    "Read README.md and ensure it has a Contributing section. Stop when done.",
    {
      signal: controller.signal,
      maxTurns: 5,
      judgeModel: "openai/gpt-4o-mini",
    },
  )) {
    console.log(JSON.stringify(event, null, 2));
    if (event.type === "status_change" && event.status === "completed") {
      console.log("Goal completed!");
    }
  }
} finally {
  await agent.dispose();
}
```

**README.md** — explica que é real-LLM (OPENROUTER_API_KEY required), e que demonstra cancellation via AbortController.

#### Tasks
1. Criar 3 arquivos do example.
2. `pnpm typecheck` cross-package.
3. **Rodar com `OPENROUTER_API_KEY` real** + capturar output completo.

#### TDD
```
RED:     N/A (example, não test)
GREEN:   Example runs end-to-end com real LLM
VERIFY:  cd examples/run-until-goal && pnpm install && OPENROUTER_API_KEY=... pnpm start
```

#### Acceptance Criteria
- [ ] Typecheck clean
- [ ] Real-LLM run captura events em ordem
- [ ] AbortController causa `paused` final
- [ ] README documenta requirement de real key

#### DoD
- [ ] Output real-LLM capturado em CHANGELOG ou em comments no PR

---

## Phase 6: Docs + ADRs + CHANGELOG + CLAUDE.md roadmap

**Objective:** 13 ADRs (D110-D122) escritos individualmente em `.claude/knowledge-base/adrs/`; CHANGELOG entries; CLAUDE.md roadmap atualizado.

### T6.1 — Escrever 13 ADRs

#### Objective
1 ADR por decisão, file format consistente com D86-D109. ≤80 linhas cada.

#### Files to edit
```
.claude/knowledge-base/adrs/D110-fork-agent-canonical-home.md (NEW)
.claude/knowledge-base/adrs/D111-async-local-storage-whitelist.md (NEW)
.claude/knowledge-base/adrs/D112-byte-identical-system-prompt.md (NEW)
.claude/knowledge-base/adrs/D113-auto-deny-approval-fork.md (NEW)
.claude/knowledge-base/adrs/D114-memory-write-provenance.md (NEW)
.claude/knowledge-base/adrs/D115-goal-event-discriminated-union.md (NEW)
.claude/knowledge-base/adrs/D116-run-until-async-generator.md (NEW)
.claude/knowledge-base/adrs/D117-abort-signal-integration.md (NEW)
.claude/knowledge-base/adrs/D118-pause-clear-goal-instance-methods.md (NEW)
.claude/knowledge-base/adrs/D119-judge-model-default-gpt-4o-mini.md (NEW)
.claude/knowledge-base/adrs/D120-verdict-enum-three-values.md (NEW)
.claude/knowledge-base/adrs/D121-fail-safe-continue-max-cap.md (NEW)
.claude/knowledge-base/adrs/D122-run-until-cloud-unsupported.md (NEW)
```

#### DoD
- [ ] 13 ADRs criados, cada com Context/Decision/Consequences/Implementation
- [ ] CHANGELOG entry

---

### T6.2 — CHANGELOG + CLAUDE.md roadmap

#### Files to edit
```
packages/sdk/CHANGELOG.md — add Unreleased entry para background-work-block-completion (ADRs D110-D122)
CLAUDE.md — Decided ADRs table (D110-D122) + SDK Patterns Roadmap Background work block 3/3 ✅ + Totais 19→22 (96%)
```

#### DoD
- [ ] CHANGELOG completo
- [ ] CLAUDE.md ADR table tem 13 novas linhas
- [ ] Roadmap totais atualizado
- [ ] Tier 4 status atualizado (Background work 3/3 ✅)

---

## Phase 7: Dogfood QA (MANDATORY) — Telegram-pro 30/30 com /goal probe

**Objective:** Validar que tudo funciona end-to-end em real workload via CDP dogfood skill.

### T7.1 — Adicionar probe `/goal` em telegram-pro

#### Objective
Comando novo `/goal <prompt>` em `examples/telegram-pro/`. Drives `runUntil` loop com judge model `openai/gpt-4o-mini` fixed. Bot envia events em mensagens separadas (turn_start, agent_response trimmed, judge_verdict).

#### Files to edit
```
examples/telegram-pro/src/commands/goal.ts (NEW)
examples/telegram-pro/src/bot.ts — wire /goal command
.claude/skills/telegram-pro-dogfood/lib/scenarios.mjs — add scenario #30 (/goal probe)
```

#### Deep Dives
**goal.ts** — wraps `agent.runUntil(prompt, { maxTurns: 3, judgeModel: "openai/gpt-4o-mini" })`. Bot replies per event.

**scenarios.mjs probe:**
```javascript
{
  name: "/goal short",
  send: "/goal create a haiku about robots and stop when done",
  expect: /(turn_start|agent_response|judge_verdict|completed|max turns)/i,
  timeoutMs: 90_000,
}
```

#### Tasks
1. Implementar goal.ts.
2. Wire em bot.ts.
3. Add scenario.

#### Acceptance Criteria
- [ ] `/goal` responde com pelo menos 1 event message
- [ ] Dogfood scenario passes

---

### T7.2 — Run `/dogfood full` telegram-pro

#### Execution
```bash
cd examples/telegram-pro && pnpm dogfood:full
```

#### Acceptance Criteria
- [ ] 30/30 scenarios PASS (29 atuais + /goal)
- [ ] Zero CRITICAL issues
- [ ] Real LLM (not fixture) — confirmar via `isFixtureApiKey` check + latência ≥ 1s
- [ ] OPENROUTER_API_KEY ou OPENAI_API_KEY set no `.env`

#### If dogfood fails
- Identify root cause (not "downgrade to fixture")
- Fix + re-run

### DoD (Plan-level)

- [ ] All phases completed
- [ ] All tests passing (853 → 920+ esperado)
- [ ] Zero biome warnings (G2 clean)
- [ ] G8 size guard cumprido (todos os novos files ≤400 LoC)
- [ ] Backward compatibility preserved (V1.2 caller API byte-by-byte per D108)
- [ ] CLAUDE.md roadmap atualizado (Background work 3/3 ✅; totais 19→22)
- [ ] **Dogfood telegram-pro 30/30 PASS** com real LLM
- [ ] Real-LLM example shipped (`examples/run-until-goal/`)
- [ ] 13 ADRs em `.claude/knowledge-base/adrs/`
- [ ] CHANGELOG `[Unreleased]` entry
- [ ] Runtime-metric proof — `agent.runUntil` yields events in real workload (probe `/goal` em telegram-pro)

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | forked-agent-pattern PENDING → DONE | T1.1, T1.2, T4.3 | AsyncLocalStorage + forkAgent + Agent.fork shorthand |
| 2 | async-iterable-streaming PARTIAL → DONE | T3.1, T3.2, T4.2 | GoalEvent union + runUntil AsyncGenerator + Agent.runUntil |
| 3 | judge-call-pattern PENDING → DONE | T2.1, T2.2, T2.3 | parseVerdict + judgeCall + verifyClaim |
| 4 | Per-fork isolation (não global) | T1.1, T5.2 | AsyncLocalStorage + CI lint gate |
| 5 | Byte-identical system prompt (cache hit) | T1.2 | fork.options.systemPrompt === parent.options.systemPrompt |
| 6 | Auto-deny approval (TUI deadlock) | T1.2, T4.1 | tool dispatch whitelist gate antes de plugin/file hooks |
| 7 | Memory write provenance | T1.2 | metadata.forkOrigin no AgentOptions |
| 8 | Verdict enum (3 values) | T2.1 | DONE/CONTINUE/SKIPPED strict |
| 9 | Fail-safe continue + max-cap | T3.2, T2.1 | consecutiveFailures counter |
| 10 | AbortSignal integration | T3.2 | signal check no turn boundary |
| 11 | Cloud agent throws | T4.2, T4.3 | UnsupportedRunOperationError |
| 12 | Adversarial property tests | T5.1 | 800+ fast-check runs |
| 13 | CI lint gate | T5.2 | grep regex test |
| 14 | Real-LLM example | T5.3 | examples/run-until-goal/ |
| 15 | Dogfood probe | T7.1, T7.2 | /goal command em telegram-pro |

**Coverage: 15/15 gaps (100%)**

---

> **Edge Case Review status:** PENDING — invoke `/edge-case-plan background-work-block-completion` after this plan is saved.
