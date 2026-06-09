# Plan: Plugin & Extension Block Completion — Plugin Contract + Tool Registry + Provider as Plugin

> **Version 1.0 — COMPLETED 2026-05-19.** Tests 853/853 (765 → 853 = +88). Typecheck/build clean. Live dogfood telegram-pro: **29/29 PASS** via CDP-driven skill. Roadmap totais 16 → 19 (83%) DONE. 13 ADRs (D97-D109).
>
> **Version 1.0** — Fecha os 3 patterns do Plugin & extension block (`plugin-contract-design` ❌ → ✅; `tool-registry-pattern` ⚠️ → ✅; `provider-as-plugin` ❌ → ✅). Entrega: (a) `internal/plugins/` com `Plugin` discriminated-union (kinds: `general | memory | model-provider`), `PluginContext` sealed-em-dev API, hook system com enum fechado (`pre_tool_call` veto inclusive), `PluginManager` com lifecycle único `register(ctx)`; (b) `internal/tool-registry/` com `ToolRegistry` central, `Toolset` flat-list, `check-fn` TTL-cached (30s), dispatch pipeline registry→toolset→availability→exec; (c) `internal/providers/` com `ProviderProfile` data-only, `registerProvider`/`getProviderProfile`/`listProviders`, lazy-discovery em `~/.theokit/plugins/model-providers/`, 4 builtins migrados (Anthropic + OpenAI + OpenRouter + Gemini), Transport ABC orthogonal a Profile, V1.2 caller API preservada. Resultado: Tier 2 macro roadmap fechado; SDK roadmap totais 16 → 19 (83%) DONE; ecossistema `@theokit-provider-*` destravado.

## Context

O SDK Patterns Roadmap em `CLAUDE.md` lista 3 patterns abertos no Plugin & extension block:

```
| plugin-contract-design  | ❌ PENDING  | internal/plugins/manager.ts + Plugin interface (a criar) |
| tool-registry-pattern   | ⚠️ PARTIAL  | defineTool (D24) existe; falta ToolRegistry + Toolset    |
| provider-as-plugin      | ❌ PENDING  | Providers hardcoded; migrar para ProviderProfile lazy discovery |
```

**Por que NOW, não LATER:**

1. **Sem Plugin contract não existe ecossistema de extensão.** Auditoria do SDK:
   - `internal/plugins/` **não existe** — apenas `runtime/plugins-manager.ts` (que lê PLUGIN.md metadata mas não chama `register()` em código nenhum).
   - Sem `Plugin` interface pública, `PluginContext` sealed API, ou hook system. Plugins atuais SÃO METADATA não código executável.
   - Hermes shipou e fixou hardcoded plugin CLI (PR #5295 v0.8 — 95 linhas honcho argparse vivendo em `main.py`). SDK herda esse risco se um único example precisar branchear no core.
   - Hermes investiu **4 releases** (PR #14424 → #20324) refazendo plugin contract por escolha ruim de shape inicial. Pagar esse custo no theokit-sdk é desnecessário — a referência canonical já existe.

2. **Tool registry está parcial.** `defineTool` (ADR D24) existe e produz `CustomTool` shape, mas:
   - Não há `ToolRegistry` central — tools são colectadas ad-hoc em `agent-loop/loop.ts:initLoopContext` (custom + memory + MCP).
   - Não há `Toolset` (named bundle de tools) — caller não consegue dizer "este agent vê só X, Y, Z".
   - Não há `check_fn` para "tool requires env var / external binary" — model recebe schema com `image_generate` registrada mesmo sem `OPENAI_API_KEY`.
   - Não há cap de resultado (`max_result_size_chars`) — `find /` retorna 5MB → inflate context.
   - Hermes ships **98 tools** com esse pattern; SDK ainda terá 5-10, mas a estrutura precisa estar pronta antes do volume crescer.

3. **Providers hardcoded — fork necessária para novo provider.** Estado atual em `internal/llm/router.ts:43-47`:
   ```typescript
   function buildClient(name: string): LlmClient | undefined {
     if (name === "anthropic") return buildAnthropicFromEnv();
     if (name === "openai" || name === "openrouter") return buildOpenAILikeFromEnv(name);
     return undefined;
   }
   ```
   - 3 providers cobertos via switch case + 2 builders inline.
   - Adicionar Mistral, Cohere, Bedrock, AzureFoundry, ou self-hosted requer: novo arquivo, novo switch case, validação que aceita nome novo, tests — i.e. PR contra core.
   - Provider-as-plugin reduz isso para: NPM publish `@theokit-provider-mistral` + user instala + funciona.
   - Hermes ships **22 providers** com profile-driven pattern (Transport ABC orthogonal) — zero code branches no agent loop.

**Evidência empírica:**

- `ls packages/sdk/src/internal/plugins/` → **diretório não existe**.
- `grep -rn "registerProvider\|getProviderProfile\|ProviderProfile" packages/sdk/src/` → **0 hits**.
- `grep -rn "ToolRegistry\|Toolset" packages/sdk/src/` → **0 hits** (registry inline ad-hoc).
- `internal/llm/router.ts:43-47` — switch hardcoded para 3 providers.
- `internal/llm/anthropic.ts:68`, `openai.ts:52`, `router.ts:67` — base URLs hardcoded nos clients.
- `runtime/plugins-manager.ts` — lê metadata (`PLUGIN.md` frontmatter via D77) mas nunca executa um plugin.
- Tier 1 macro roadmap completo (commit `defc9a3` + `5ae711a` — agent-core-loop-completion + dogfood expansão). Pré-requisito de Tier 2 está fechado.
- Knowledge-base completa: `plugin-contract-design.md` (332 linhas), `tool-registry-pattern.md` (367 linhas), `provider-as-plugin.md` (407 linhas).

## Objective

Fechar Tier 2 do macro roadmap em uma sprint: SDK Patterns Roadmap Plugin & extension 3/3 ✅, totais 16 → 19 (83%) DONE. Adicionar um provider novo (Mistral) deve requerer 0 mudanças em `packages/sdk/src/`. Adicionar um tool plugin com hook `pre_tool_call` veto deve requerer 0 mudanças em `packages/sdk/src/`. A V1.2 caller API (`Agent.create({ provider: "anthropic", tools, plugins })`) deve continuar funcionando byte-by-byte.

**Metas mensuráveis:**

1. **`internal/plugins/`** (NOVO) — 4 módulos: `types.ts`, `manager.ts`, `context.ts`, `lifecycle.ts`. Plugin discriminated-union por `kind`. PluginContext sealed via Proxy em dev.
2. **`internal/tool-registry/`** (NOVO) — 4 módulos: `registry.ts`, `toolset.ts`, `check-fn-cache.ts`, `dispatch.ts`. Registry central + Toolset flat list + check_fn TTL 30s + dispatch pipeline 3-layer.
3. **`internal/providers/`** (NOVO) — `registry.ts`, `discovery.ts`, `builtin/{anthropic,openai,openrouter,gemini}.ts`, `transports/{chat-completions,anthropic-messages}.ts`. 4 builtins data-driven; lazy discovery em `~/.theokit/plugins/model-providers/`.
4. **`Agent.create({ plugins })`** — wires Plugin lifecycle em LocalAgent (`register(ctx)` chamado 1x no `initialize`). Cloud Agent: documentado como "plugin metadata only" (cloud runtime instancia server-side; out-of-scope).
5. **Tool dispatch wiring** — `agent-loop/tool-dispatch.ts` consume `ToolRegistry` + `getAvailableTools(toolset)` no lugar do collect inline atual.
6. **Provider router wiring** — `internal/llm/router.ts:buildClient` consulta `getProviderProfile(name)` + selectTransport(apiMode) em vez do switch hardcoded.
7. **CI gates** — adversarial property tests via fast-check (≥600 runs) cobrindo registry duplicate detection, alias resolution, check_fn cache TTL, plugin sealed.
8. **`@theokit/example-plugin-blocker`** — example novo: plugin com `pre_tool_call` veto sobre `shell` com `rm -rf` (smoke-test do hook system contra um caso real).
9. **Roadmap update** — CLAUDE.md: Plugin & extension 3/3 ✅; totais 16 → 19 (83%); Tier 2 fechado.
10. **Telegram-pro live dogfood 29/29 PASS** + 1 cenário novo (Plugin example provando hook executou).
11. **Zero regressão** em unit tests (765/765 atual deve subir para 830+).

## ADRs

| ID | Decisão | Rationale | Consequências |
|---|---|---|---|
| **D97** | `internal/plugins/` é o **home canonical** para Plugin contract — separado de `runtime/plugins-manager.ts` (que vira deprecated alias) | Manager atual só lê PLUGIN.md metadata. Embora reuse o nome "plugins", a SHAPE é completamente diferente: novo `PluginManager` executa `register(ctx)` em código de plugin, antigo só listava. Coexistir confunde callers; trans-pkg path `internal/plugins/` é deliberadamente novo | Enables: novo path limpo; v1.2 callers continuam usando `agent.plugins.list()` para metadata. Constrains: 2 dirs com nome similar — mitigado por JSDoc cross-ref + deprecation entry no `runtime/plugins-manager.ts` |
| **D98** | `Plugin` é **discriminated union por `kind`** (`"general" \| "memory" \| "model-provider"`), não interface única | Hermes deep-dive mostra que os 3 kinds têm lifecycles fundamentalmente diferentes (general eager-load, memory per-agent, model-provider lazy). Misturar em uma única interface acabou em double-instantiation bugs no Python (`AGENTS.md:467-562`). Discriminated union em TS tipa cada kind separadamente — sem chance de invocar `createProvider` em um plugin general | Enables: TS exhaustiveness check em PluginManager switch; cada kind valida só os campos relevantes. Constrains: adicionar 4° kind requer adicionar à union + caso no switch (não é silent extension) |
| **D99** | `PluginContext` é **sealed via Proxy em dev mode**, plain object em produção | Hermes' "plugins MUST NOT modify core files" (AGENTS.md:509-513) é regra inquebrável. JS é dinâmico — sem Proxy guard, plugin `(ctx as any).someInternal = "boom"` passaria silent. Em dev a Proxy intercepta SET → throw; em prod o overhead da Proxy é eliminado (plain object) porque a maioria dos abuses já foi pega em CI | Enables: catch de plugin mal-comportado em CI/dev. Constrains: TS-level garantia já forte; Proxy é defense-in-depth |
| **D100** | `HookName` é **enum literal fechado**: 8 hooks fixos | Hooks arbitrários levam a "hook-of-hook" sprawl. Cada hook é decisão deliberada do core + announcement. Os 8 hooks (pre/post tool call, pre/post LLM call, on session start/end, transform tool result, transform LLM output) cobrem 95% dos use cases sem reabrir o contract | Enables: TS rejeita `ctx.on("my_typo", ...)` no compile time. Constrains: adicionar hook nova é feature do core (não plugin) — força disciplina |
| **D101** | `pre_tool_call` retorna `{ block: true, message }` para vetar — não throw | Throw quebra a conversação. Veto retorna pelo tool_result com `isError: false, content: blockedMessage` (ADR D89 generalização). Model recebe a explicação e escolhe outra abordagem (tentar com args diferentes, usar outra tool, comunicar ao user) | Enables: safety guards (dangerous-command interceptor, MCP approval) sem crash do loop. Constrains: handler que QUER throw para emergencies absolute → throw vai propagar normalmente; veto é o caminho default |
| **D102** | `ToolRegistry` central com **3 layers** (registration → exposure → availability) — não dict gigante | Hermes ships 98 tools com este pattern. Cada layer mutate independente: tools NOVAS chegam via plugins (registration); diferentes agentes veem subsets (exposure via Toolset); tools com deps externas filtram dinamicamente (availability via check_fn) | Enables: scale para 50+ tools sem refactor; user filter por toolset name. Constrains: 3 layers vs 1 dict — overhead conceitual mitigado por nomes claros e JSDoc |
| **D103** | `check_fn` resultados são **TTL-cached por 30s** — não chamado por tool por turn | Sem cache, cada turn invoca o check_fn (que pode ser network probe). 30s é compromisso entre fresh + perf: dev pode notar que `playwright` foi unstalado em 30s, e turns rapid-fire não pagam 5 × `which git` | Enables: tools com check_fn caros (HTTP probe, package import) ficam viáveis. Constrains: 30s entre uninstall e detection — documentado como known limit |
| **D104** | `Toolset` é **flat list** explícita, sem `extends` | Composition por herança causa ambiguidade ("toolset A extends B; B extends C; é A em C?"). Hermes evita explicitamente com `_HERMES_CORE_TOOLS = [...]` + cada toolset declara list completa. SDK herda a postura | Enables: clarity ("este toolset tem EXATAMENTE estes tools"); Sem ambiguity de override. Constrains: duplicação se 2 toolsets compartilham 5 tools — aceito como trade-off de clareza |
| **D105** | `ProviderProfile` é **interface data-only**, não ABC com métodos | V1.3 original do Hermes tentou "ProviderPlugin é ABC". Mudou para interface data-only (PR #20324) porque 90% dos providers só diferem em URL + env_vars + fallback_models. ABC força new class por provider — overkill (`provider-as-plugin.md:293-306`) | Enables: declarar provider novo é 10 linhas de objeto literal. Constrains: provider com lógica de auth complexa (OAuth device flow) precisa do `authType` field + handler resolver-side; não pode meter código no profile |
| **D106** | **Transport ABC** orthogonal a Profile: `apiMode` no profile → `selectTransport(apiMode)` no router | Profile = WHAT (data); Transport = HOW (HTTP dialect). Separa-los permite que Mistral (chat_completions dialect) shippe profile sem transport; OpenAI Codex (responses_api dialect) shippe profile + transport sem tocar chat_completions. 4 transports cobrem 95% do mercado de LLM hoje | Enables: 22 providers Hermes funcionam com 4 transports. Constrains: dialect totalmente novo (e.g., Bedrock streaming) requer Transport novo — claim explicit, não silent fork |
| **D107** | Provider discovery é **lazy + last-writer-wins** com warn | Built-ins eager-load no module init. User plugins em `~/.theokit/plugins/model-providers/` lazy-scanned no primeiro `getProviderProfile(name)`. Override (user re-registra `anthropic`) loga WARN no stderr. Idempotência: discovery roda 1x por processo | Enables: user customiza Anthropic profile (e.g., self-hosted proxy URL) sem fork. Constrains: warn em stderr; operadores devem grep "[theokit] Provider ... overridden" no log |
| **D108** | **V1.2 caller API preservada** byte-by-byte (`Agent.create({ provider, plugins, tools })`) | Quebrar API == quebrar usuários. Migração v1.2 → v1.3 é interna: `provider: "anthropic"` continua aceita; internamente resolve via `getProviderProfile`. `plugins: [...]` no v1.2 era metadata; agora aceita Plugin objects. Type union se expande, nunca shrinks | Enables: telegram-pro + 7 outros examples continuam compilando sem mudança. Constrains: tipo `plugins` aceita ambos (metadata legacy + Plugin objects) — discriminação via shape (`register` function presente vs ausente) |
| **D109** | **Tool dispatch wiring é refactor incremental**: Phase 1+2+3 produzem módulos; Phase 4 swap dentro do agent-loop | Big-bang swap (todo o agent-loop reescrito) é alto risco. Incremental: tools coletadas inline continuam funcionando até Phase 4 cutover; Phase 5 remove código legacy. Reduce o blast radius de cada commit | Enables: bisect-friendly se um phase quebra; revert atómico de cada step. Constrains: 2 caminhos de dispatch coexistem por 1 phase — documentado como temporário com TODO comment |

## Dependency Graph

```
Phase 0 (audit) ──┬──▶ Phase 1 (Plugin contract)
                  │
                  ├──▶ Phase 2 (Tool Registry)
                  │
                  └──▶ Phase 3 (Provider as Plugin)
                              │
                              ▼
                  Phase 4 (wire all 3 into LocalAgent + agent-loop)
                              │
                              ▼
                  Phase 5 (CI gates + adversarial fast-check + example plugin)
                              │
                              ▼
                  Phase 6 (docs + 13 ADRs + CHANGELOG + CLAUDE.md)
                              │
                              ▼
                  Phase 7 (Final Dogfood QA — telegram-pro 29/29 + plugin probe)
```

- **Phase 1, 2, 3 são paralelizáveis** após Phase 0 (sem cross-deps; 3 módulos novos independentes).
- **Phase 4 bloqueia em 1+2+3** (precisa de todos os módulos para wirar).
- **Phase 5 → Phase 6 → Phase 7** sequenciais.

---

## Phase 0: Foundation — Audit & Inventory

**Objective:** Inventário fechado de callers atuais que serão refatorados em Phase 4.

### T0.1 — Audit Provider router + Tool collection sites

#### Objective
Lista exaustiva de (a) onde `buildClient(name)` é chamado, (b) onde tools são coletadas inline em `agent-loop/loop.ts:initLoopContext`, (c) onde plugins.list() é consumido para metadata only.

#### Evidence
`internal/llm/router.ts:43-47` switch hardcoded; `agent-loop/loop.ts:79-118` initLoopContext coleta tools ad-hoc; `runtime/plugins-manager.ts` é só metadata.

#### Files to edit
```
.claude/knowledge-base/plans/plugin-extension-block-completion-plan.md — append inventory tabela
```

#### Deep file dependency analysis
- Pura análise. Saída anexa como Coverage Matrix.

#### Tasks
1. `grep -rn "buildClient\|resolveProviderChain" packages/sdk/src/`
2. `grep -rn "tools.push\|initLoopContext\|collectTools" packages/sdk/src/`
3. `grep -rn "agent.plugins" examples/`
4. Documentar lista em comentário do plano.

#### TDD
```
N/A — audit puro.
GREEN: inventory documentado.
VERIFY: outro engenheiro reproduz via grep.
```

#### Acceptance Criteria
- [ ] 3 listas (router callers, tool-collection sites, plugin metadata consumers) documentadas
- [ ] 0 sites ambíguos

#### DoD
- [ ] Inventory revisado + plano atualizado

---

## Phase 1: Plugin Contract — Types + Manager + Context + Lifecycle

**Objective:** Entregar `internal/plugins/` com 4 módulos + tipos públicos exportados. Cobertura ≥90% por módulo.

### T1.1 — Criar `internal/plugins/types.ts`

#### Objective
`Plugin`, `PluginContext`, `HookName`, `HookHandler`, `CommandHandler` types públicos. Discriminated union por `kind`.

#### Evidence
- `plugin-contract-design.md:82-133` — TS canonical.
- ADRs D98 (discriminated union), D100 (HookName enum fechado).

#### Files to edit
```
packages/sdk/src/internal/plugins/types.ts (NEW)
packages/sdk/src/internal/plugins/index.ts (NEW barrel)
packages/sdk/src/index.ts — re-exportar Plugin + PluginContext públicos
```

#### Deep file dependency analysis
- `types.ts` (NEW) — leaf, zero runtime deps. Importa `CustomTool` de `define-tool.ts` (já existe, D24).
- `index.ts` (NEW) — barrel para Phase 4 wire.
- `packages/sdk/src/index.ts` — adiciona 4 re-exports (Plugin, PluginContext, HookName, definePlugin).

#### Deep Dives
**Tipos finais:**
```typescript
import type { CustomTool } from "../../define-tool.js";
import type { ProviderProfile } from "../providers/types.js"; // forward — Phase 3
import type { MemoryProvider } from "../memory/provider.js"; // future — keep optional

export type HookName =
  | "pre_tool_call"
  | "post_tool_call"
  | "pre_llm_call"
  | "post_llm_call"
  | "on_session_start"
  | "on_session_end"
  | "transform_tool_result"
  | "transform_llm_output";

export interface PreToolCallContext {
  name: string;
  args: Record<string, unknown>;
  agentId: string;
  runId: string;
}

export interface PreToolCallDecision {
  block: true;
  message: string;
}

export type HookHandler =
  | ((ctx: PreToolCallContext) => PreToolCallDecision | undefined | void | Promise<PreToolCallDecision | undefined | void>)
  | ((ctx: unknown) => void | Promise<void>); // other hooks have different ctx shapes; widened for v1

export interface CommandHandler {
  (args: Record<string, unknown>): Promise<string> | string;
}

export interface PluginContext {
  /** Register a custom tool. Wraps `defineTool` shape — equivalent to passing in AgentOptions.tools. */
  registerTool(tool: CustomTool): void;
  /** Register a slash-command-style handler (consumed by CLI/bot wrappers; not used by agent loop). */
  registerCommand(name: string, handler: CommandHandler, opts?: { description?: string }): void;
  /** Attach a hook handler. `pre_tool_call` is the most-used; supports veto via PreToolCallDecision. */
  on(hook: HookName, handler: HookHandler): void;
  /** Inject a user/system message into the next agent turn (advanced; v1 supports only on_session_start). */
  injectMessage(content: string, role?: "user" | "system"): void;
}

interface BasePlugin {
  name: string;
  version: string;
}

export type Plugin =
  | (BasePlugin & {
      kind: "general";
      register: (ctx: PluginContext) => void | Promise<void>;
    })
  | (BasePlugin & {
      kind: "memory";
      createProvider: (cwd: string) => MemoryProvider;
    })
  | (BasePlugin & {
      kind: "model-provider";
      profile: ProviderProfile;
    });

/**
 * Helper for plugin authors. TS-only — no runtime cost.
 */
export function definePlugin<P extends Plugin>(p: P): P {
  return p;
}
```

**Invariantes:**
- `Plugin.kind` é literal — não string genérica.
- `definePlugin` é identity function — pura para tooling.
- `PreToolCallDecision` é `{ block: true, message }` (não `{ block: boolean }`) — typescript narrow força handler a comprometer.

**Edge cases:**
- Plugin sem `kind`: compile error.
- Plugin com `kind: "general"` mas sem `register`: compile error (discriminated union).
- Plugin com `kind: "model-provider"` precisa de `profile` que vem do Phase 3 — para Phase 1 a interface é forward-declared (Phase 3 add).

#### Tasks
1. Criar `internal/plugins/types.ts` per spec.
2. Criar barrel `internal/plugins/index.ts`.
3. Adicionar exports em `packages/sdk/src/index.ts`: `Plugin`, `PluginContext`, `HookName`, `PreToolCallContext`, `PreToolCallDecision`, `definePlugin`.
4. Forward-declarar `ProviderProfile` + `MemoryProvider` (Phase 3 fills the implementation).

#### TDD
```
RED:     test_define_plugin_general_round_trip()        — { kind: "general", register: fn } compiles + returns identity
RED:     test_define_plugin_missing_kind_fails()         — TS type test: { register: fn } sem kind compile error (via type-test file)
RED:     test_define_plugin_model_provider_shape()      — { kind: "model-provider", profile: {...} } typed
RED:     test_define_plugin_memory_shape()              — { kind: "memory", createProvider: fn } typed
RED:     test_define_plugin_wrong_handler_for_kind_fails() — { kind: "general", profile: {...} } compile error
GREEN:   Implementar types
REFACTOR: None
VERIFY:  cd packages/sdk && pnpm vitest run tests/internal/plugins/types.test.ts && pnpm typecheck
```

#### Acceptance Criteria
- [ ] 5 testes RED → GREEN (4 runtime + 1 type-test compile-error)
- [ ] `definePlugin` é pure identity
- [ ] Type union compila com strict TS
- [ ] Zero biome warnings
- [ ] Cobertura ≥90%

#### DoD
- [ ] `pnpm typecheck` + `pnpm vitest` clean
- [ ] CHANGELOG `[Unreleased]` Added entry

---

### T1.2 — Criar `internal/plugins/context.ts` (PluginContext impl + seal)

#### Objective
Concrete `PluginContext` implementation que coleta tool/command/hook/inject registrations e (em dev) é sealed via Proxy contra abuse.

#### Evidence
- ADR D99 — sealed em dev, plain em prod.
- `plugin-contract-design.md:297-307` — sealed check pattern.

#### Files to edit
```
packages/sdk/src/internal/plugins/context.ts (NEW)
packages/sdk/src/internal/plugins/index.ts (append export)
```

#### Deep file dependency analysis
- `context.ts` (NEW) — depende de `types.ts` (T1.1) + `CustomTool` (define-tool.ts). Não depende de PluginManager (T1.3 — manager construct ctx + passa ao plugin).

#### Deep Dives
**Shape:**
```typescript
import type { CustomTool } from "../../define-tool.js";
import type {
  CommandHandler,
  HookHandler,
  HookName,
  PluginContext,
} from "./types.js";

interface CommandEntry {
  name: string;
  handler: CommandHandler;
  description?: string;
}

interface InjectedMessage {
  content: string;
  role: "user" | "system";
}

export interface PluginRegistrations {
  tools: CustomTool[];
  commands: CommandEntry[];
  hooks: Map<HookName, HookHandler[]>;
  injected: InjectedMessage[];
}

export function createPluginContext(): {
  ctx: PluginContext;
  registrations: PluginRegistrations;
} {
  const registrations: PluginRegistrations = {
    tools: [],
    commands: [],
    hooks: new Map(),
    injected: [],
  };

  const impl: PluginContext = {
    registerTool(tool) {
      registrations.tools.push(tool);
    },
    registerCommand(name, handler, opts = {}) {
      registrations.commands.push({ name, handler, ...(opts.description !== undefined ? { description: opts.description } : {}) });
    },
    on(hook, handler) {
      // EC-2 fix: defense-in-depth. Plugin author can bypass TS via `as any`
      // and pass null/undefined; ignore + warn rather than crash the loop.
      if (typeof handler !== "function") {
        process.stderr.write(
          `[theokit-sdk] ignoring non-function handler for hook "${hook}"\n`,
        );
        return;
      }
      const existing = registrations.hooks.get(hook) ?? [];
      existing.push(handler);
      registrations.hooks.set(hook, existing);
    },
    injectMessage(content, role = "user") {
      registrations.injected.push({ content, role });
    },
  };

  // D99: dev-mode seal via Proxy. Catches `(ctx as any).foo = 1` style abuse.
  const ctx = process.env.NODE_ENV !== "production" ? sealContext(impl) : impl;
  return { ctx, registrations };
}

function sealContext(impl: PluginContext): PluginContext {
  return new Proxy(impl, {
    set(_target, prop) {
      throw new Error(
        `[theokit-sdk] PluginContext is sealed — cannot set ${String(prop)}. ` +
          `Plugins must use the documented API (registerTool, registerCommand, on, injectMessage).`,
      );
    },
    deleteProperty(_target, prop) {
      throw new Error(`[theokit-sdk] PluginContext is sealed — cannot delete ${String(prop)}.`);
    },
  });
}
```

**Invariantes:**
- Cada `createPluginContext()` retorna par fresh `{ctx, registrations}` — uma instância NOVA por plugin.
- `registrations` é o "spy" para o PluginManager ler depois do `register()`.
- `ctx` em prod é o impl raw (zero overhead); em dev é Proxy sealed.

**Edge cases:**
- Plugin chama `registerTool` 3x → 3 tools no array.
- Plugin chama `on("pre_tool_call", h1)` + `on("pre_tool_call", h2)` → 2 handlers na key.
- Plugin chama `injectMessage` sem role → default "user".
- Plugin tenta `(ctx as any).newField = "x"` em dev → throw "PluginContext is sealed".
- Mesmo plugin tentativa em prod → silently succeeds (TS-only check sobrou).

#### Tasks
1. Criar `context.ts` per spec.
2. Implementar `createPluginContext` + `sealContext`.
3. Adicionar export `{ createPluginContext, PluginRegistrations }` no barrel.

#### TDD
```
RED:     test_context_registerTool_collects()
RED:     test_context_registerCommand_collects()
RED:     test_context_on_multiple_handlers_per_hook()
RED:     test_context_injectMessage_default_user_role()
RED:     test_context_sealed_throws_on_set_in_dev()        — EC: stubEnv NODE_ENV !== production
RED:     test_context_unsealed_in_production()              — stubEnv NODE_ENV = production → set passes
RED:     test_context_isolated_per_plugin()                 — 2 ctx instances don't share registrations
GREEN:   Implementar
VERIFY:  pnpm vitest run tests/internal/plugins/context.test.ts
```

#### Acceptance Criteria
- [ ] 7 testes verdes
- [ ] Sealed seul em dev (verified via stubEnv)
- [ ] Cobertura ≥95%

#### DoD
- [ ] Clean

---

### T1.3 — Criar `internal/plugins/manager.ts` (PluginManager)

#### Objective
`PluginManager` constrói ctx para cada plugin, invoca `register()` uma vez, agrega registrations, expõe para LocalAgent.

#### Evidence
- ADR D98 (discriminated union por kind).
- `plugin-contract-design.md:269-278` — register called exactly once.

#### Files to edit
```
packages/sdk/src/internal/plugins/manager.ts (NEW)
packages/sdk/src/internal/plugins/index.ts (append export)
```

#### Deep file dependency analysis
- Depende de `types.ts` (T1.1) + `context.ts` (T1.2) + `lifecycle.ts` (T1.4 — para `transform_*` dispatch).
- Não importa Provider/Memory ainda (Phase 3 connection point é `provider-as-plugin`).

#### Deep Dives
**Shape:**
```typescript
import { createPluginContext, type PluginRegistrations } from "./context.js";
import type { Plugin } from "./types.js";

export interface AggregatedPlugins {
  tools: PluginRegistrations["tools"];
  commands: PluginRegistrations["commands"];
  /** Hooks aggregated across all plugins. Iteration order = plugin registration order. */
  hooks: PluginRegistrations["hooks"];
  injected: PluginRegistrations["injected"];
  /** Provider profiles contributed by model-provider plugins (Phase 3). */
  providerProfiles: Array<{ pluginName: string; profile: import("../providers/types.js").ProviderProfile }>;
  /** Memory provider factories (forward — Phase TBD). */
  memoryProviders: Array<{ pluginName: string; createProvider: (cwd: string) => unknown }>;
}

export class PluginManager {
  #aggregated: AggregatedPlugins = {
    tools: [],
    commands: [],
    hooks: new Map(),
    injected: [],
    providerProfiles: [],
    memoryProviders: [],
  };
  #initialized = false;

  async initialize(plugins: ReadonlyArray<Plugin>): Promise<void> {
    if (this.#initialized) {
      throw new Error("PluginManager.initialize called twice — register only once per process");
    }
    this.#initialized = true;
    // EC-4: surface duplicate plugin names so operators notice. Two plugins
    // with the same name are likely a mistake (npm install with override).
    const seen = new Set<string>();
    for (const plugin of plugins) {
      if (seen.has(plugin.name)) {
        process.stderr.write(
          `[theokit-sdk] duplicate plugin name "${plugin.name}" — both will register independently\n`,
        );
      }
      seen.add(plugin.name);
      await this.#dispatchPlugin(plugin);
    }
  }

  get aggregated(): Readonly<AggregatedPlugins> {
    return this.#aggregated;
  }

  /** Run all `pre_tool_call` hooks; first decision with `block: true` wins. */
  async runPreToolCallHooks(
    ctx: import("./types.js").PreToolCallContext,
  ): Promise<import("./types.js").PreToolCallDecision | undefined> {
    const handlers = this.#aggregated.hooks.get("pre_tool_call") ?? [];
    for (const h of handlers) {
      const decision = await h(ctx);
      if (decision !== undefined && (decision as { block?: boolean }).block === true) {
        return decision as import("./types.js").PreToolCallDecision;
      }
    }
    return undefined;
  }

  async #dispatchPlugin(plugin: Plugin): Promise<void> {
    if (plugin.kind === "general") {
      const { ctx, registrations } = createPluginContext();
      await plugin.register(ctx);
      this.#merge(registrations);
    } else if (plugin.kind === "model-provider") {
      this.#aggregated.providerProfiles.push({
        pluginName: plugin.name,
        profile: plugin.profile,
      });
    } else if (plugin.kind === "memory") {
      this.#aggregated.memoryProviders.push({
        pluginName: plugin.name,
        createProvider: plugin.createProvider,
      });
    }
  }

  #merge(r: PluginRegistrations): void {
    this.#aggregated.tools.push(...r.tools);
    this.#aggregated.commands.push(...r.commands);
    for (const [hook, handlers] of r.hooks.entries()) {
      const existing = this.#aggregated.hooks.get(hook) ?? [];
      existing.push(...handlers);
      this.#aggregated.hooks.set(hook, existing);
    }
    this.#aggregated.injected.push(...r.injected);
  }
}
```

**Invariantes:**
- `initialize()` chamada uma única vez por instance — segundo call throws.
- Plugin de kind `"general"` recebe `ctx` e seu `register()` é awaited.
- Plugin de kind `"model-provider"` apenas registra o profile (sem invocar function — profile é dados).
- Plugin de kind `"memory"` apenas guarda a factory (consumida lazy quando agent precisa).
- Ordem de hook handlers preserva ordem de plugin registration.

**Edge cases:**
- 0 plugins → aggregated permanece vazio; sem erro.
- Plugin que throws no `register` → propaga (caller decide se fail-fast ou skip).
- 2 plugins registram tool com mesmo nome → ambos vão pro array; ToolRegistry (Phase 2) detecta dup.
- Plugin com `kind` desconhecido (TS bypassed): TS exhaustiveness pega; runtime ignora silenciosamente.

#### Tasks
1. Criar `manager.ts` per spec.
2. Implementar `PluginManager` class.
3. Implementar `runPreToolCallHooks` (consumed Phase 4).
4. Adicionar export `{ PluginManager, AggregatedPlugins }` no barrel.

#### TDD
```
RED:     test_manager_initialize_once()                    — segundo call throws
RED:     test_manager_calls_register_per_general_plugin()  — register() spy called 1x per plugin
RED:     test_manager_aggregates_tools_from_multiple_plugins()
RED:     test_manager_aggregates_hooks_in_order()
RED:     test_manager_provider_plugin_collects_profile()   — kind=model-provider doesn't call register
RED:     test_manager_memory_plugin_collects_factory()
RED:     test_manager_zero_plugins_no_error()
RED:     test_manager_propagates_register_throw()
RED:     test_pre_tool_call_first_block_wins()             — handler1 returns undefined, handler2 returns block → block wins
RED:     test_pre_tool_call_no_handlers_returns_undefined()
RED:     test_manager_duplicate_plugin_name_warns()       — EC-4: 2 plugins same name → both register, stderr warn surface
GREEN:   Implementar
VERIFY:  pnpm vitest run tests/internal/plugins/manager.test.ts
```

#### Acceptance Criteria
- [ ] 10 testes verdes
- [ ] Cobertura ≥90%
- [ ] Cyclomatic complexity ≤10

#### DoD
- [ ] Clean

---

### T1.4 — Criar `internal/plugins/lifecycle.ts` (hook dispatch helpers)

#### Objective
Helpers para invocar hooks `post_tool_call`, `pre_llm_call`, `post_llm_call`, `on_session_start`, `on_session_end`, `transform_*` — extraído do manager para evitar 500-line manager.

#### Evidence
- `plugin-contract-design.md:84-92` — 8 hook names.
- ADR D86 (separação por concerns mirror) — same logic for plugin lifecycle.

#### Files to edit
```
packages/sdk/src/internal/plugins/lifecycle.ts (NEW)
packages/sdk/src/internal/plugins/index.ts (append exports)
```

#### Deep file dependency analysis
- `lifecycle.ts` (NEW) — depende de `types.ts` + `manager.ts` (consumes aggregated.hooks).

#### Deep Dives
**Shape:**
```typescript
import type { HookHandler } from "./types.js";

/**
 * Run all handlers for a fire-and-forget hook (post_tool_call,
 * on_session_start, on_session_end, transform_*). Handlers run in
 * registration order; one handler throwing does NOT stop the others.
 *
 * @internal
 */
export async function runFireAndForgetHooks<C>(
  handlers: ReadonlyArray<HookHandler>,
  ctx: C,
): Promise<void> {
  for (const h of handlers) {
    try {
      await (h as (c: C) => unknown)(ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[theokit-sdk] plugin hook threw (continuing): ${msg}\n`);
    }
  }
}

/**
 * Run transform hooks — each handler can return a NEW value that replaces
 * the input for the next handler. `undefined` return means "no change".
 *
 * @internal
 */
export async function runTransformHooks<T>(
  handlers: ReadonlyArray<HookHandler>,
  initial: T,
): Promise<T> {
  let current = initial;
  for (const h of handlers) {
    try {
      const next = await (h as (c: T) => T | undefined)(current);
      if (next !== undefined) current = next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[theokit-sdk] plugin transform hook threw (continuing): ${msg}\n`);
    }
  }
  return current;
}
```

**Invariantes:**
- Fire-and-forget hooks NUNCA throw — erros são logged + continuam.
- Transform hooks aceitam um valor inicial; handler retornando `undefined` significa no-op; retornando T substitui.
- Erros em transform handler: logged + skipped (current preserved).

#### Tasks
1. Criar `lifecycle.ts`.
2. Implementar 2 helpers.
3. Exportar via barrel.

#### TDD
```
RED:     test_fire_and_forget_runs_all_handlers()
RED:     test_fire_and_forget_one_throws_others_continue()
RED:     test_transform_chain_passes_value()             — h1: x→y, h2: y→z, result === z
RED:     test_transform_undefined_keeps_current()
RED:     test_transform_null_replaces_current()          — EC-6: handler returns null (not undefined) → current becomes null
RED:     test_transform_throw_keeps_current()
GREEN:   Implementar
VERIFY:  pnpm vitest run tests/internal/plugins/lifecycle.test.ts
```

#### Acceptance Criteria
- [ ] 5 testes verdes
- [ ] Cobertura ≥95%

#### DoD
- [ ] Clean

---

## Phase 2: Tool Registry

**Objective:** Entregar `internal/tool-registry/` com 4 módulos cobrindo os 3 layers (registration → exposure → availability).

### T2.1 — Criar `tool-registry/registry.ts` (ToolEntry + ToolRegistry)

#### Files to edit
```
packages/sdk/src/internal/tool-registry/registry.ts (NEW)
packages/sdk/src/internal/tool-registry/index.ts (NEW barrel)
```

#### Deep Dives
**Shape:**
```typescript
import type { CustomTool } from "../../define-tool.js";

export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string> | string;
  toolset?: string;
  checkFn?: () => boolean | Promise<boolean>;
  requiresEnv?: ReadonlyArray<string>;
  emoji?: string;
  maxResultSizeChars?: number;
}

export class ToolRegistry {
  #entries = new Map<string, ToolEntry>();

  register(entry: ToolEntry): void {
    if (this.#entries.has(entry.name)) {
      throw new Error(`Tool "${entry.name}" already registered`);
    }
    this.#entries.set(entry.name, entry);
  }

  get(name: string): ToolEntry | undefined {
    return this.#entries.get(name);
  }

  list(): ToolEntry[] {
    return Array.from(this.#entries.values());
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  /** Build a ToolEntry from a CustomTool (defineTool output). */
  static fromCustomTool(custom: CustomTool, opts?: { toolset?: string }): ToolEntry {
    return {
      name: custom.name,
      description: custom.description,
      inputSchema: custom.inputSchema as Record<string, unknown>,
      handler: custom.handler as ToolEntry["handler"],
      ...(opts?.toolset !== undefined ? { toolset: opts.toolset } : {}),
    };
  }
}
```

**Edge cases:**
- Register duplicado → throw.
- `fromCustomTool` extrai shape — bridge para D24.
- Registry vazio: `list()` retorna `[]`.

#### TDD
```
RED:     test_registry_register_then_get()
RED:     test_registry_duplicate_throws()
RED:     test_registry_list_returns_all()
RED:     test_registry_has_returns_bool()
RED:     test_from_custom_tool_extracts_shape()
RED:     test_from_custom_tool_with_toolset()
GREEN:   Implementar
VERIFY:  pnpm vitest run tests/internal/tool-registry/registry.test.ts
```

#### Acceptance Criteria
- [ ] 6 testes verdes
- [ ] Cobertura ≥95%

#### DoD
- [ ] Clean

---

### T2.2 — Criar `tool-registry/toolset.ts` (named bundles)

#### Files to edit
```
packages/sdk/src/internal/tool-registry/toolset.ts (NEW)
```

#### Deep Dives
**Shape:**
```typescript
import type { ToolEntry, ToolRegistry } from "./registry.js";

export interface Toolset {
  name: string;
  tools: ReadonlyArray<string>;
}

export const CORE_TOOLSET: Toolset = {
  name: "core",
  tools: ["shell", "read_file", "write_file", "memory_search", "memory_get"],
};

/**
 * Resolve a Toolset to actual ToolEntry instances. Tools not found in
 * the registry are SILENTLY DROPPED (consistent with availability layer
 * filter; absent tool === unavailable tool from the model's POV).
 *
 * Caller-supplied toolsets that need to fail loud should use
 * `resolveToolsetStrict` instead (throws on missing).
 */
export function resolveToolset(toolset: Toolset, registry: ToolRegistry): ToolEntry[] {
  return toolset.tools
    .map((name) => registry.get(name))
    .filter((e): e is ToolEntry => e !== undefined);
}

export function resolveToolsetStrict(toolset: Toolset, registry: ToolRegistry): ToolEntry[] {
  return toolset.tools.map((name) => {
    const entry = registry.get(name);
    if (entry === undefined) {
      throw new Error(`Toolset "${toolset.name}" references unknown tool "${name}"`);
    }
    return entry;
  });
}
```

**Edge cases:**
- Toolset com tool name não registrado → `resolve` drops silently; `resolveStrict` throws.
- Toolset vazio → array vazio.

#### TDD
```
RED:     test_toolset_resolves_to_entries()
RED:     test_toolset_drops_missing_tools_silently()
RED:     test_toolset_strict_throws_on_missing()
RED:     test_toolset_empty_returns_empty()
RED:     test_core_toolset_constant_shape()
RED:     test_toolset_duplicates_kept_caller_dedup_responsibility() — EC-7: ["shell", "shell"] returns 2 entries; caller dedups if needed
GREEN:   Implementar
VERIFY:  pnpm vitest run tests/internal/tool-registry/toolset.test.ts
```

#### Acceptance Criteria
- [ ] 5 testes verdes
- [ ] ADR D104 documented (flat, no extends)

#### DoD
- [ ] Clean

---

### T2.3 — Criar `tool-registry/check-fn-cache.ts` (TTL availability)

#### Files to edit
```
packages/sdk/src/internal/tool-registry/check-fn-cache.ts (NEW)
```

#### Deep Dives
**Shape:**
```typescript
import type { ToolEntry } from "./registry.js";

const TTL_MS = 30_000;

interface CacheEntry {
  result: boolean;
  expiresAt: number;
}

// Module-scoped Map (single cache per process). Test reset via _resetForTests.
const cache = new Map<string, CacheEntry>();

export async function isToolAvailable(entry: ToolEntry): Promise<boolean> {
  // requiresEnv: hard env var check, no cache (cheap).
  if (entry.requiresEnv !== undefined) {
    for (const v of entry.requiresEnv) {
      if (process.env[v] === undefined || process.env[v] === "") return false;
    }
  }

  if (entry.checkFn === undefined) return true;

  const cached = cache.get(entry.name);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  let result: boolean;
  try {
    result = await entry.checkFn();
  } catch {
    result = false; // EC: checkFn throw treated as unavailable
  }
  cache.set(entry.name, { result, expiresAt: Date.now() + TTL_MS });
  return result;
}

/** Reset cache. Test-only. @internal */
export function _resetCheckFnCache(): void {
  cache.clear();
}

/** Compose registry + toolset + availability into the final list. */
export async function getAvailableTools(
  entries: ReadonlyArray<ToolEntry>,
): Promise<ToolEntry[]> {
  const checks = await Promise.all(
    entries.map(async (e) => ({ entry: e, ok: await isToolAvailable(e) })),
  );
  return checks.filter((x) => x.ok).map((x) => x.entry);
}
```

**Edge cases:**
- Tool sem `checkFn` nem `requiresEnv` → sempre available.
- `requiresEnv` lista com env vazio → unavailable.
- `checkFn` throws → treated as unavailable (false), cached.
- Multiple calls dentro de 30s → 1 invocation real, demais cache hit.

#### TDD
```
RED:     test_available_no_checkfn_no_env()
RED:     test_unavailable_missing_env()
RED:     test_available_env_present()
RED:     test_checkfn_called_once_within_ttl()
RED:     test_checkfn_called_again_after_ttl()
RED:     test_checkfn_throw_treated_as_unavailable()
RED:     test_get_available_tools_filters()
RED:     test_reset_clears_cache()
RED:     test_checkfn_concurrent_promise_all_idempotent()  — EC-8: 3 calls em Promise.all; ≥1 invocation, result consistent
GREEN:   Implementar
VERIFY:  pnpm vitest run tests/internal/tool-registry/check-fn-cache.test.ts
```

#### Acceptance Criteria
- [ ] 8 testes verdes
- [ ] TTL 30s respected (verified via `vi.advanceTimersByTime`)

#### DoD
- [ ] Clean

---

### T2.4 — Result truncation helper

#### Files to edit
```
packages/sdk/src/internal/tool-registry/result-cap.ts (NEW)
```

#### Deep Dives
**Shape:**
```typescript
const DEFAULT_CAP = 100_000;

export function applyResultCap(content: string, capChars: number = DEFAULT_CAP): string {
  if (content.length <= capChars) return content;
  return `${content.slice(0, capChars)}\n\n[output truncated: ${content.length - capChars} chars omitted]`;
}
```

#### TDD
```
RED:     test_cap_no_op_under_threshold()
RED:     test_cap_truncates_over_threshold()
RED:     test_cap_marker_includes_count()
RED:     test_cap_custom_threshold()
GREEN:   Implementar
VERIFY:  pnpm vitest
```

#### Acceptance Criteria
- [ ] 4 testes verdes

#### DoD
- [ ] Clean

---

## Phase 3: Provider as Plugin

**Objective:** Entregar `internal/providers/` + Transport ABC + migrar 4 builtins (Anthropic + OpenAI + OpenRouter + Gemini-via-OpenRouter).

### T3.1 — Criar `internal/providers/types.ts` (ProviderProfile + ApiMode)

#### Files to edit
```
packages/sdk/src/internal/providers/types.ts (NEW)
packages/sdk/src/internal/providers/index.ts (NEW barrel)
```

#### Deep Dives
**Shape:**
```typescript
export type ApiMode = "chat_completions" | "anthropic_messages" | "responses_api" | "bedrock";
export type AuthType = "api_key" | "oauth_device_code" | "oauth_external" | "aws_sdk";

export interface ProviderProfile {
  name: string;
  apiMode: ApiMode;
  aliases?: ReadonlyArray<string>;
  displayName?: string;
  description?: string;
  signupUrl?: string;
  envVars: ReadonlyArray<string>;
  authType: AuthType;
  baseUrl: string;
  modelsUrl?: string;
  hostname?: string;
  fallbackModels: ReadonlyArray<string>;
  extraHeaders?: Record<string, string>;
  bodyOverrides?: Record<string, unknown>;
}
```

#### TDD
```
RED:     test_provider_profile_type_compiles()           — type-level test via type-test file
RED:     test_api_mode_is_finite_union()
GREEN:   Implementar
VERIFY:  pnpm typecheck
```

#### Acceptance Criteria
- [ ] Types compilam com strict TS

#### DoD
- [ ] Clean

---

### T3.2 — Criar `internal/providers/registry.ts`

#### Files to edit
```
packages/sdk/src/internal/providers/registry.ts (NEW)
```

#### Deep Dives
**Shape:**
```typescript
import type { ProviderProfile } from "./types.js";

const REGISTRY = new Map<string, ProviderProfile>();
const ALIASES = new Map<string, string>();

export function registerProvider(profile: ProviderProfile): void {
  if (REGISTRY.has(profile.name)) {
    process.stderr.write(
      `[theokit-sdk] Provider "${profile.name}" overridden by user plugin.\n`,
    );
  }
  REGISTRY.set(profile.name, profile);
  for (const alias of profile.aliases ?? []) {
    // EC-5: surface alias collision so operators don't silently route to wrong provider.
    const previous = ALIASES.get(alias);
    if (previous !== undefined && previous !== profile.name) {
      process.stderr.write(
        `[theokit-sdk] Alias "${alias}" collision: was "${previous}", now "${profile.name}".\n`,
      );
    }
    ALIASES.set(alias, profile.name);
  }
}

export function getProviderProfile(name: string): ProviderProfile | undefined {
  const canonical = ALIASES.get(name) ?? name;
  return REGISTRY.get(canonical);
}

export function listProviders(): ProviderProfile[] {
  return Array.from(REGISTRY.values());
}

/** Test-only reset. @internal */
export function _resetProvidersForTests(): void {
  REGISTRY.clear();
  ALIASES.clear();
}
```

**Edge cases:**
- Override warn → stderr (D107).
- Unknown name → `undefined` (caller decides if fatal).
- Alias resolves to canonical.

#### TDD
```
RED:     test_register_and_get()
RED:     test_alias_resolves_to_canonical()
RED:     test_override_logs_warn()
RED:     test_list_includes_all_registered()
RED:     test_unknown_name_returns_undefined()
RED:     test_reset_clears_all()
RED:     test_alias_collision_logs_warn()                  — EC-5: 2 providers, same alias → warn "Alias X collision: was Y, now Z"
GREEN:   Implementar (registerProvider checks ALIASES.has before overwrite)
VERIFY:  pnpm vitest run tests/internal/providers/registry.test.ts
```

#### Acceptance Criteria
- [ ] 6 testes verdes

#### DoD
- [ ] Clean

---

### T3.3 — Migrar 4 builtins para profiles

#### Files to edit
```
packages/sdk/src/internal/providers/builtin/anthropic.ts (NEW)
packages/sdk/src/internal/providers/builtin/openai.ts (NEW)
packages/sdk/src/internal/providers/builtin/openrouter.ts (NEW)
packages/sdk/src/internal/providers/builtin/gemini.ts (NEW — via OpenRouter passthrough)
packages/sdk/src/internal/providers/builtin/index.ts (NEW eager-register)
```

#### Deep Dives
**4 profiles:**
```typescript
// builtin/anthropic.ts
import type { ProviderProfile } from "../types.js";
export const ANTHROPIC: ProviderProfile = {
  name: "anthropic",
  apiMode: "anthropic_messages",
  envVars: ["ANTHROPIC_API_KEY"],
  authType: "api_key",
  baseUrl: "https://api.anthropic.com",
  modelsUrl: "https://api.anthropic.com/v1/models",
  hostname: "api.anthropic.com",
  fallbackModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
};

// builtin/openai.ts
export const OPENAI: ProviderProfile = {
  name: "openai",
  apiMode: "chat_completions",
  envVars: ["OPENAI_API_KEY"],
  authType: "api_key",
  baseUrl: "https://api.openai.com",
  modelsUrl: "https://api.openai.com/v1/models",
  hostname: "api.openai.com",
  fallbackModels: ["gpt-4o", "gpt-4o-mini"],
};

// builtin/openrouter.ts
export const OPENROUTER: ProviderProfile = {
  name: "openrouter",
  apiMode: "chat_completions",
  aliases: ["or"],
  envVars: ["OPENROUTER_API_KEY", "OPENAI_API_KEY"], // fallback
  authType: "api_key",
  baseUrl: "https://openrouter.ai/api",
  modelsUrl: "https://openrouter.ai/api/v1/models",
  hostname: "openrouter.ai",
  fallbackModels: ["openai/gpt-4o-mini", "anthropic/claude-3-haiku"],
};

// builtin/gemini.ts — Gemini IS reachable directly but SDK routes via OpenRouter today
export const GEMINI: ProviderProfile = {
  name: "gemini",
  apiMode: "chat_completions",
  envVars: ["OPENROUTER_API_KEY"],
  authType: "api_key",
  baseUrl: "https://openrouter.ai/api",
  hostname: "openrouter.ai",
  fallbackModels: ["google/gemini-2.0-flash-001"],
};

// builtin/index.ts — eager registration on module init
import { registerProvider } from "../registry.js";
import { ANTHROPIC } from "./anthropic.js";
import { OPENAI } from "./openai.js";
import { OPENROUTER } from "./openrouter.js";
import { GEMINI } from "./gemini.js";

registerProvider(ANTHROPIC);
registerProvider(OPENAI);
registerProvider(OPENROUTER);
registerProvider(GEMINI);
```

#### TDD
```
RED:     test_anthropic_profile_registered()
RED:     test_openai_profile_registered()
RED:     test_openrouter_alias_or_resolves()
RED:     test_gemini_profile_registered()
RED:     test_all_have_valid_api_mode()
GREEN:   Implementar
VERIFY:  pnpm vitest
```

#### Acceptance Criteria
- [ ] 4 builtins eagerly registered on import
- [ ] Aliases resolve

#### DoD
- [ ] Clean

---

### T3.4 — Lazy discovery `~/.theokit/plugins/model-providers/`

#### Files to edit
```
packages/sdk/src/internal/providers/discovery.ts (NEW)
```

#### Deep Dives
**Shape:**
```typescript
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { getProfilesRoot } from "../persistence/paths.js";
import { registerProvider } from "./registry.js";

let discovered = false;

export async function discoverProviderPlugins(): Promise<void> {
  if (discovered) return;
  discovered = true;

  // For now, scan ~/.theokit/plugins/model-providers/
  // Each subdir is a plugin package. We look for index.js that default-exports
  // a Plugin with kind === "model-provider".
  const root = join(getProfilesRoot(), "..", "plugins", "model-providers");
  if (!existsSync(root)) return;

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  for (const entry of entries) {
    const indexPath = join(root, entry, "index.js");
    if (!existsSync(indexPath)) continue;
    try {
      const mod = await import(indexPath);
      const plugin = mod.default ?? mod[entry];
      if (plugin?.kind === "model-provider" && plugin?.profile !== undefined) {
        registerProvider(plugin.profile);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[theokit-sdk] failed to load provider plugin "${entry}": ${msg}\n`);
    }
  }
}

/** Test-only reset. @internal */
export function _resetDiscovery(): void {
  discovered = false;
}
```

**Edge cases:**
- Directory doesn't exist → no-op.
- Plugin throws on import → logged, skipped.
- Second call → no-op (idempotent).

#### TDD
```
RED:     test_discovery_idempotent()
RED:     test_discovery_no_directory_no_op()
RED:     test_discovery_loads_valid_plugin()         — fixture: tmpdir + index.js with profile
RED:     test_discovery_skips_broken_plugin()
RED:     test_discovery_loads_real_esm_plugin()      — EC-9: index.mjs with `export default {...}`, dynamic import works on Node 22 (may need file:// URL)
GREEN:   Implementar
VERIFY:  pnpm vitest run tests/internal/providers/discovery.test.ts
```

#### Acceptance Criteria
- [ ] 4 testes verdes

#### DoD
- [ ] Clean

---

## Phase 4: Wire — LocalAgent + agent-loop + tool-dispatch + router

**Objective:** Substituir hardcoded sites por novos módulos. Backward-compat preservada.

### T4.1 — Wire PluginManager em LocalAgent.initialize

#### Files to edit
```
packages/sdk/src/internal/runtime/local-agent.ts — initialize chama new PluginManager
packages/sdk/src/types/agent.ts — AgentOptions.plugins aceita Plugin[] | legacy metadata
```

#### Deep Dives
- `AgentOptions.plugins` aceita ambos `Plugin[]` (novo, código executável) E legacy metadata `{ enabled: string[] }` (v1.2). EC-1 fix:
  ```typescript
  function isCodePlugin(p: unknown): p is Plugin {
    if (p === null || typeof p !== "object" || !("kind" in p)) return false;
    const kind = (p as { kind: unknown }).kind;
    if (kind === "general") return "register" in p && typeof (p as { register: unknown }).register === "function";
    if (kind === "model-provider") return "profile" in p && typeof (p as { profile: unknown }).profile === "object";
    if (kind === "memory") return "createProvider" in p && typeof (p as { createProvider: unknown }).createProvider === "function";
    return false;
  }
  const codePlugins = Array.isArray(options.plugins) ? options.plugins.filter(isCodePlugin) : [];
  ```
  Telegram-pro + 7 examples atualmente passam `plugins: { enabled: ["..."] }` (object, not array) → `Array.isArray` false → `codePlugins = []` → no crash.
- LocalAgent constrói `pluginManager = new PluginManager()` no construtor; `await pluginManager.initialize(codePlugins)` em `initialize()`.
- `aggregated.tools` somam ao `customTools` que o agent-loop já consome.

#### TDD
```
RED:     test_agent_create_with_general_plugin_registers_tool()  — plugin.registerTool() → agent.skills sees it (or tools list)
RED:     test_agent_create_with_zero_plugins_works()
RED:     test_agent_with_pre_tool_call_veto_blocks_shell()        — plugin vetos shell with rm -rf
RED:     test_legacy_metadata_plugins_ignored_at_runtime()        — EC-1: { plugins: { enabled: ["openrouter"] } } does NOT crash (filtered out, codePlugins empty)
RED:     test_v1_2_telegram_pro_plugins_shape_compiles_and_runs() — EC-1: exact shape from telegram-pro/sdk-config.ts
GREEN:   Wire
VERIFY:  pnpm vitest
```

#### Acceptance Criteria
- [ ] 3 testes verdes
- [ ] V1.2 callers continuam compilando

#### DoD
- [ ] Clean

---

### T4.2 — Wire pre_tool_call hook em agent-loop/tool-dispatch.ts

#### Files to edit
```
packages/sdk/src/internal/agent-loop/tool-dispatch.ts — invoca pluginManager.runPreToolCallHooks ANTES do hooks.run("preToolUse")
```

#### Deep Dives
- Plugin hooks fire ANTES dos file-based hooks (`.theokit/hooks/`). Razão: plugin é código autor; file-hooks são operator policy.
- Decisão de plugin que `block: true` → tool_result `isError: false, content: message` (D101).
- File-based hooks roda depois (já existente em `dispatchSingleCall`).

#### TDD
```
RED:     test_plugin_pre_tool_call_blocks_before_file_hook()
RED:     test_plugin_no_handler_falls_through_to_file_hook()
GREEN:   Wire
VERIFY:  pnpm vitest run tests/internal/agent-loop/
```

#### Acceptance Criteria
- [ ] 2 testes verdes

#### DoD
- [ ] Clean

---

### T4.3 — Wire ProviderProfile + Transport em router.ts

#### Files to edit
```
packages/sdk/src/internal/llm/router.ts — buildClient consulta getProviderProfile
packages/sdk/src/internal/llm/transports/ (NEW dir) — chat-completions.ts + anthropic-messages.ts (thin wrappers around existing AnthropicClient/OpenAIClient)
```

#### Deep Dives
- `buildClient(name)` substitui o switch por:
  1. `await discoverProviderPlugins()` (idempotent)
  2. `profile = getProviderProfile(name)` (undefined → return undefined preserving current behavior)
  3. `selectTransport(profile.apiMode)` → Transport wraps the appropriate LlmClient
  4. Resolve API key via `envVars` ordered fallback (EC-10): first env var present wins
  5. Returns LlmClient with profile.baseUrl + resolved key

- **EC-3 fix:** `selectTransport(apiMode)` é exhaustive switch que throws com mensagem actionable em modes unsupported:
  ```typescript
  function selectTransport(apiMode: ApiMode): { mode: ApiMode; build: (opts: ClientOptions) => LlmClient } {
    switch (apiMode) {
      case "chat_completions":
        return { mode: apiMode, build: (o) => new OpenAIClient(o) };
      case "anthropic_messages":
        return { mode: apiMode, build: (o) => new AnthropicClient(o) };
      case "responses_api":
      case "bedrock":
        throw new ConfigurationError(
          `Provider apiMode "${apiMode}" is not supported by this SDK release. ` +
            `Install a third-party transport plugin (e.g. @theokit-transport-${apiMode}) ` +
            `or use a provider with apiMode "chat_completions" / "anthropic_messages".`,
          { code: "transport_unavailable" },
        );
      default: {
        const _exhaustive: never = apiMode;
        return _exhaustive; // unreachable — TS exhaustiveness
      }
    }
  }
  ```
- **EC-10 fix:** Resolução de API key:
  ```typescript
  function resolveApiKey(envVars: ReadonlyArray<string>): string | undefined {
    for (const v of envVars) {
      const value = process.env[v];
      if (value !== undefined && value.length > 0) return value;
    }
    return undefined;
  }
  ```

- Transport ABC is initially a thin wrapper around existing clients — full refactor is out of scope (would require restructuring `LlmClient.stream` interface). Phase 4 wires the routing path; future refactor can split the clients further.

#### TDD
```
RED:     test_build_client_anthropic_via_profile()
RED:     test_build_client_openrouter_alias()
RED:     test_build_client_user_overridden_provider()    — register custom anthropic profile → buildClient uses it
RED:     test_build_client_unknown_returns_undefined()
RED:     test_select_transport_unsupported_apimode_throws() — EC-3: responses_api/bedrock → ConfigurationError with transport_unavailable code
RED:     test_envvars_first_match_wins()                   — EC-10: profile.envVars=[OPENROUTER, OPENAI]; only OPENAI set → resolves to OPENAI value
GREEN:   Wire
VERIFY:  pnpm vitest run tests/internal/llm/router.test.ts
```

#### Acceptance Criteria
- [ ] 4 testes verdes
- [ ] V1.2 caller `Agent.create({ provider: "anthropic" })` continues to work

#### DoD
- [ ] Clean

---

## Phase 5: CI Gates + Adversarial Tests + Example Plugin

### T5.1 — Property tests para Plugin/Tool/Provider registries

#### Files to edit
```
packages/sdk/tests/internal/plugins/manager.property.test.ts (NEW)
packages/sdk/tests/internal/tool-registry/registry.property.test.ts (NEW)
packages/sdk/tests/internal/providers/registry.property.test.ts (NEW)
```

#### Deep Dives
- Plugin: hook order preserved across N plugins (≤8) of varying kinds — 200 runs.
- ToolRegistry: register/get round-trip for any name in `[a-z0-9_-]{1,32}` — 200 runs.
- Provider: alias resolution arbitrary order doesn't change canonical — 200 runs.

#### Acceptance Criteria
- [ ] 3 property files × ~3 props × 200 runs ≥ 1800 inputs

---

### T5.2 — Example plugin `@theokit/example-plugin-blocker`

#### Files to edit
```
examples/plugin-blocker/package.json (NEW)
examples/plugin-blocker/src/index.ts (NEW)
examples/plugin-blocker/README.md (NEW)
```

#### Deep Dives
Plugin general kind. Hooks `pre_tool_call` to block shell calls containing `rm -rf` or `:(){:|:&};:` (fork bomb). Returns `{ block: true, message: "Destructive command blocked by theokit-example-plugin-blocker" }`.

#### Acceptance Criteria
- [ ] Plugin compile + roda em isolated test
- [ ] Telegram-pro pode optar-in via `plugins: [plugin]` no opts (Phase 7 cenário)

---

### T5.3 — Lint gate: no hardcoded provider name in router

#### Files to edit
```
packages/sdk/tests/lint/no-hardcoded-provider-name.test.ts (NEW)
```

#### Deep Dives
Grep `internal/llm/router.ts` for hardcoded strings `"anthropic"`, `"openai"`, `"openrouter"` outside comments. After Phase 4, router should only reference `getProviderProfile(name)` — names live in `internal/providers/builtin/`.

#### Acceptance Criteria
- [ ] Lint passes against post-Phase-4 codebase
- [ ] Lint fails against pre-refactor fixture

---

## Phase 6: Docs + 13 ADRs + CHANGELOG + CLAUDE.md

### T6.1 — Criar ADRs D97-D109 (13 ADRs)

#### Files to edit
```
.claude/knowledge-base/adrs/D97-plugins-internal-home.md (NEW)
.claude/knowledge-base/adrs/D98-plugin-discriminated-union.md (NEW)
.claude/knowledge-base/adrs/D99-plugin-context-sealed.md (NEW)
.claude/knowledge-base/adrs/D100-hook-name-enum-fechado.md (NEW)
.claude/knowledge-base/adrs/D101-pre-tool-call-veto.md (NEW)
.claude/knowledge-base/adrs/D102-tool-registry-3-layers.md (NEW)
.claude/knowledge-base/adrs/D103-check-fn-ttl-cache.md (NEW)
.claude/knowledge-base/adrs/D104-toolset-flat-no-extends.md (NEW)
.claude/knowledge-base/adrs/D105-provider-profile-data-only.md (NEW)
.claude/knowledge-base/adrs/D106-transport-abc-orthogonal.md (NEW)
.claude/knowledge-base/adrs/D107-provider-lazy-discovery.md (NEW)
.claude/knowledge-base/adrs/D108-v12-api-preserved.md (NEW)
.claude/knowledge-base/adrs/D109-incremental-refactor.md (NEW)
```

#### Acceptance Criteria
- [ ] 13 ADRs presentes, 1 por decisão

---

### T6.2 — docs.md Plugin section + CHANGELOG

#### Files to edit
```
docs.md — append "Plugin & Extension (v1.8+)" section
packages/sdk/CHANGELOG.md — [Unreleased] entries
```

---

### T6.3 — Update CLAUDE.md roadmap

#### Files to edit
```
CLAUDE.md — Plugin & extension block 3/3 DONE; totais 16 → 19 DONE
```

---

## Phase 7: Final Dogfood QA (MANDATORY)

### T7.1 — Telegram-pro live 29/29 PASS

#### Execution
```bash
cd examples/telegram-pro
nohup pnpm tsx --env-file=.env src/index.ts > /tmp/tgpro-dogfood.log 2>&1 & disown
sleep 8 && grep "Connected as @" /tmp/tgpro-dogfood.log

cd /home/paulo/Projetos/usetheo/theokit-sdk
node .claude/skills/telegram-pro-dogfood/lib/dogfood.mjs --user-id 7528967933
```

### T7.2 — Plugin probe: add `example-plugin-blocker` to telegram-pro, validate veto

Cenário extra: telegram-pro carrega o plugin via `plugins: [blocker]`. Cenário: usuário invoca shell com `rm -rf /tmp/foo`. Bot deve responder com o blocked message.

#### Acceptance Criteria
- [ ] 29/29 PASS no skill canonical
- [ ] Probe extra: shell rm -rf bloqueado pelo plugin

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Plugin contract: types (Plugin, PluginContext, HookName) | T1.1 | discriminated union + sealed ctx |
| 2 | Plugin contract: PluginContext sealed em dev | T1.2 | Proxy-based seal |
| 3 | Plugin contract: PluginManager lifecycle | T1.3 | initialize once + dispatch by kind |
| 4 | Plugin contract: hook dispatch helpers | T1.4 | fire-and-forget + transform |
| 5 | Plugin contract: pre_tool_call veto | T1.3 + T4.2 | runPreToolCallHooks + agent-loop wire |
| 6 | Tool registry: ToolEntry + register/get/list | T2.1 | ToolRegistry class |
| 7 | Tool registry: Toolset named bundles | T2.2 | flat-list resolveToolset |
| 8 | Tool registry: check_fn TTL cache | T2.3 | 30s TTL + getAvailableTools |
| 9 | Tool registry: result cap | T2.4 | applyResultCap |
| 10 | Provider as plugin: ProviderProfile types | T3.1 | data-only interface |
| 11 | Provider as plugin: registry + alias | T3.2 | registerProvider/getProviderProfile |
| 12 | Provider as plugin: 4 builtin profiles | T3.3 | Anthropic/OpenAI/OpenRouter/Gemini |
| 13 | Provider as plugin: lazy discovery | T3.4 | ~/.theokit/plugins/model-providers |
| 14 | Wire PluginManager em LocalAgent | T4.1 | initialize chains in |
| 15 | Wire pre_tool_call em tool-dispatch | T4.2 | hook fires before file-hooks |
| 16 | Wire ProviderProfile em router | T4.3 | getProviderProfile replaces switch |
| 17 | Property tests (3 registries × ~3 props × 200) | T5.1 | fast-check 1800+ inputs |
| 18 | Example plugin | T5.2 | @theokit/example-plugin-blocker |
| 19 | CI lint: no hardcoded provider name | T5.3 | grep gate |
| 20 | 13 ADRs D97-D109 | T6.1 | 13 files |
| 21 | docs.md + CHANGELOG | T6.2 | append section |
| 22 | CLAUDE.md roadmap update | T6.3 | Plugin & extension 3/3 |
| 23 | Telegram-pro live 29/29 | T7.1 | CDP skill |
| 24 | Plugin probe (blocker veto) | T7.2 | new probe |

**Coverage: 24/24 gaps cobertos (100%)**

## Edge-Case Review (incorporated)

Edge-case review identificou 15 edges (3 MUST FIX, 7 SHOULD TEST, 5 DOCUMENT). Status:

| EC | Severity | Task | Status |
|---|---|---|---|
| EC-1 | MUST FIX | T4.1 | `isCodePlugin` filter applied em deep-dive + 2 testes novos para legacy shape |
| EC-2 | MUST FIX | T1.2 | `ctx.on` guard `typeof handler !== "function"` warn-and-skip |
| EC-3 | MUST FIX | T4.3 | `selectTransport` exhaustive switch + `transport_unavailable` ConfigurationError |
| EC-4 | SHOULD TEST | T1.3 | `test_manager_duplicate_plugin_name_warns` + stderr surface |
| EC-5 | SHOULD TEST | T3.2 | `test_alias_collision_logs_warn` + warn em `registerProvider` |
| EC-6 | SHOULD TEST | T1.4 | `test_transform_null_replaces_current` |
| EC-7 | SHOULD TEST | T2.2 | `test_toolset_duplicates_kept_caller_dedup_responsibility` |
| EC-8 | SHOULD TEST | T2.3 | `test_checkfn_concurrent_promise_all_idempotent` |
| EC-9 | SHOULD TEST | T3.4 | `test_discovery_loads_real_esm_plugin` (Node 22 file:// URL) |
| EC-10 | SHOULD TEST | T4.3 | `test_envvars_first_match_wins` + `resolveApiKey` ordered fallback |
| EC-11 | DOCUMENT | T1.3 | Plugin name vazio = caller's responsibility (ADR D98 note) |
| EC-12 | DOCUMENT | T1.3 | Plugin register() throw = fail-fast (ADR D98 note) |
| EC-13 | DOCUMENT | T4.2 | Hook handler timeout = follow-up (same as ADR D89) |
| EC-14 | DOCUMENT | T3.4 | 100+ plugins sequential = lento mas raro |
| EC-15 | DOCUMENT | T3.4 | Plugin em dir errado = silently skipped (kind-specific discovery) |

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing (`pnpm test` clean — current 765 should rise to 830+)
- [ ] Zero biome warnings introduced
- [ ] `pnpm typecheck` clean
- [ ] `pnpm build` clean
- [ ] Backward compatibility preserved — V1.2 callers continue to compile + run
- [ ] CLAUDE.md roadmap updated (Plugin & extension 3/3 DONE; totals 16→19 = 83%)
- [ ] CHANGELOG `[Unreleased]` populated with v1.8 plugin-extension entries
- [ ] 13 ADRs (D97-D109) present in `.claude/knowledge-base/adrs/`
- [ ] **Dogfood QA PASS** — telegram-pro 29/29 live + 1 plugin-veto probe
- [ ] **Runtime-metric proof** — fast-check ran 1800+ random inputs without failure; agent-loop runs (real LLM via dogfood) without regression; plugin example actually blocks shell
- [ ] No stubs, no mocks, no unwired code (compliant with `.claude/rules/no-stubs-no-mocks-no-wired.md`)
- [ ] Real-LLM validation (compliant with `.claude/rules/real-llm-validation.md`)

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Refactor de router.ts quebra existing telegram-pro flow | Medium | High | T4.3 mantém `provider: "anthropic"` API surface idêntica; testes incluem real bot via dogfood |
| Plugin discovery import error crasha SDK | Low | High | T3.4 catch + log + skip; idempotent discovery |
| 2 plugins registram tool com mesmo nome | Medium | Medium | ToolRegistry.register throws; documentado em ADR D102 |
| Plugin abusivo mutates ctx em prod | Low | Medium | D99 seal só em dev; ADR documenta trade-off |
| 13 ADRs muitos | Low | Low | 1 por decision — não pode ser comprimido sem perder rationale |
| Transport ABC refactor maior do que escopo | Medium | High | Phase 4 wires routing path; deeper refactor (split LlmClient) é follow-up explícito |

---

**Plan complete.** Pronto para `/edge-case-plan plugin-extension-block-completion`.
