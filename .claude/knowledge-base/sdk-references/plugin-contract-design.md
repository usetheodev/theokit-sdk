# Plugin Contract Design

> Plugins extendem o SDK sem fork. Mas o contract precisa ser
> **narrowly-typed**, com hooks em enum fechado, registration via
> contexto único (`register(ctx)`), e a regra inquebrável: **plugins
> MUST NOT modify core files**. Hermes aprendeu isso forçado pelo
> PR #5295 que removeu 95 linhas de honcho argparse hardcoded em
> `main.py`.

## Quando aplicar

Aplique quando estiver desenhando extensibilidade:

- Tools customizadas que usuários adicionam
- Memory backends pluggáveis (SQLite, LanceDB, Lance, Redis, Honcho)
- Provider plugins (OpenAI, Anthropic, custom)
- CLI subcommands customizados
- Lifecycle hooks (pre/post tool call, pre/post LLM call, session start/end)

Não aplique quando:

- Feature é one-off interno do SDK (não é extension point)
- O número de implementações conhecidas é 1 (premature abstraction)
- User pode resolver com composition simples (passar callback)

## Por que importa

Hermes evoluiu de "hardcoded providers" (v0.2-v0.12) para "providers
como plugins" (v0.13). O salvage levou **4 releases** (PR #14424 ↔ #20324).
Razão: contract design ruim na primeira tentativa.

Lições do path doloroso:

1. **Triple discovery** (general + memory + model-provider) existe porque
   misturar tipos de plugins causou double-instantiation bugs.
2. **Hardcoded plugin CLI** em `main.py` (95 linhas honcho argparse,
   PR #5295) viola o princípio de extension. Plugins registram own
   CLI via `ctx.register_cli_command`.
3. **AST autodiscovery** em Python permite "se o arquivo TEM uma chamada
   register(), importe; senão skip". Em TypeScript não temos AST inspect
   idiomático — explicit imports são a única forma defensiva.

## Pattern canonical (Python)

```python
# Em plugins/<name>/__init__.py
def register(ctx: PluginContext) -> None:
    """Single entrypoint. Plugin manager calls this once per process."""
    
    # Register a tool
    ctx.register_tool(
        name="my_tool",
        handler=my_handler,
        schema=MY_SCHEMA,
        check_fn=lambda: os.environ.get("MY_API_KEY") is not None,
        toolset="custom",
    )
    
    # Register a hook
    ctx.on("pre_tool_call", my_veto_hook)
    
    # Register a CLI command
    ctx.register_cli_command(
        name="my-action",
        parser_setup_fn=lambda p: p.add_argument("--target"),
        handler=my_cli_handler,
    )
    
    # Register a slash command
    ctx.register_command(
        name="my-slash",
        handler=my_slash_handler,
        description="Do my thing",
    )
```

Hermes' `PluginContext` (`hermes_cli/plugins.py:287`) é a única superficie
plugin sees. Sem global mutation.

## TypeScript equivalent

```typescript
// packages/sdk/src/types/plugin.ts
export type HookName =
  | "pre_tool_call"
  | "post_tool_call"
  | "pre_llm_call"
  | "post_llm_call"
  | "on_session_start"
  | "on_session_end"
  | "transform_tool_result"
  | "transform_llm_output";

export interface PluginContext {
  registerTool(spec: CustomTool): void;
  registerCommand(name: string, handler: CommandHandler, opts?: CommandOpts): void;
  on(hook: HookName, handler: HookHandler): void;
  injectMessage(content: string, role?: "user" | "system"): void;
}

export interface Plugin {
  name: string;
  version: string;
  kind: "general" | "memory" | "model-provider";
  register(ctx: PluginContext): void | Promise<void>;
}

// User code:
export const myPlugin: Plugin = {
  name: "my-plugin",
  version: "1.0.0",
  kind: "general",
  register(ctx) {
    ctx.registerTool({
      name: "my_tool",
      description: "...",
      inputSchema: z.object({ q: z.string() }),
      handler: async ({ q }) => doWork(q),
    });
    
    ctx.on("pre_tool_call", (call) => {
      if (call.name === "shell" && /rm -rf/.test(JSON.stringify(call.args))) {
        return { block: true, message: "Destructive command blocked by my-plugin" };
      }
    });
  },
};

// Wiring:
const agent = await Agent.create({
  plugins: [myPlugin],
});
```

## Architectural decisions

### AD-1: One `register(ctx)` per plugin, called once

Plugin expõe uma função `register`. PluginManager invoca uma vez na
inicialização. Sem global mutation. Manager rastreia o que cada plugin
registrou para teardown limpo.

### AD-2: Hooks são strings TIPADAS, não arbitrárias

```typescript
// Wrong:
ctx.on("my_custom_hook", handler); // Aceita string qualquer

// Right:
ctx.on("pre_tool_call", handler); // Type system rejeita typo
```

Adding hook point é decisão deliberada do core (e feature announcement).
Evita "hook-of-hook" sprawl.

### AD-3: `pre_tool_call` pode VETO (bloquear chamada)

```typescript
ctx.on("pre_tool_call", (call) => {
  // Return blocked → tool call não acontece, message vai pro LLM
  if (someCondition) {
    return { block: true, message: "Blocked by policy: ..." };
  }
  // Return undefined → continue normal
});
```

Hermes usa esse pattern para safety guards: skill content scanner,
dangerous-command interceptor, MCP OAuth approval. Tool result for LLM:
`{ isError: false, content: blockedMessage }` — model vê o bloqueio,
pode escolher outra abordagem.

### AD-4: Plugins MUST NOT modify core files

Regra inquebrável (per `AGENTS.md:509-513`):

> "plugins MUST NOT modify core files"

Tradução TS:

- Plugin não pode patch `Agent.prototype`
- Plugin não pode monkey-patch módulos do `@usetheo/sdk`
- Plugin não pode escrever em paths fora do seu próprio dir
- Plugin acessa core **APENAS via `ctx`**

Defesa: tooling. Lint rule, runtime sealed object check em dev mode.

### AD-5: Per-kind discovery (general / memory / model-provider)

Hermes tem 3 sistemas de discovery por boa razão (`AGENTS.md:467-562`):

- **General**: high-frequency hooks. Eager-imported na boot.
- **Memory**: 1 instância por agent. Activated em `Agent.create`.
- **Model-provider**: lazy catalog. Scanned on first `get_provider_profile()`.

TypeScript pode UNIFICAR num único registry com `kind` field, mas
**lifecycle continua diferente** — general loaded eager, memory/provider
lazy. Discriminated union no `Plugin` type:

```typescript
type Plugin =
  | (BasePlugin & { kind: "general"; register: GeneralRegister })
  | (BasePlugin & { kind: "memory"; createProvider: MemoryFactory })
  | (BasePlugin & { kind: "model-provider"; profile: ProviderProfile });
```

### AD-6: Plugin manifest separa metadata de código

```yaml
# plugins/<name>/plugin.yaml
name: my-plugin
version: 1.0.0
kind: general
description: Does the thing
requires:
  - "@usetheo/sdk@^1.3.0"
disabled: false  # Override via THEOKIT_PLUGIN_DISABLED=my-plugin
```

Razão: pode listar plugins SEM importá-los. Útil para `theokit plugin list`
sem side effects.

TypeScript: `package.json` já tem name+version+description. Adicionamos
`theokit.kind` e `theokit.disabled` ao package.json:

```json
{
  "name": "@yourorg/theokit-plugin-foo",
  "version": "1.0.0",
  "theokit": {
    "kind": "general",
    "disabled": false
  }
}
```

## Failure modes prevenidos

1. **Hardcoded plugin CLI em core** (v0.8 #5295 lesson): 95 linhas honcho
   argparse vivendo em `main.py`. Adicionar new memory provider exigia
   touching core. Com `ctx.register_cli_command`: plugin owns own CLI.

2. **Double-instantiation**: misturar discovery causa import-time + lazy
   instantiation do mesmo plugin. Per-kind systems evitam.

3. **Plugin clobbering core**: plugin patches `Agent.prototype.send`.
   Outro plugin patches o mesmo método. Conflict. Com `ctx`-only API:
   physically impossible.

4. **Hook sprawl**: cada feature adiciona hook arbitrário. Refactor
   nightmare. Com fixed enum: hooks são decisão de design intencional.

## Failure modes NÃO prevenidos

- **Plugin mal-comportado executes side effects fora de register**:
  carrega API key no module-level, fazendo requests. Defesa: docs (rule
  "side effects belong inside register()").

- **Plugin dependency conflicts**: 2 plugins requerem versões
  incompatíveis de uma peer dep. Standard npm/pnpm resolution.

- **Performance death**: plugin com hook `pre_tool_call` faz remote call
  lento. Toda turn fica devagar. Defesa: docs + timeout no hook
  dispatcher.

## Como testar

```typescript
it("plugin's register is called exactly once", async () => {
  const registerSpy = vi.fn();
  const plugin: Plugin = { name: "p", version: "1.0", kind: "general", register: registerSpy };
  
  const agent = await Agent.create({ plugins: [plugin] });
  await agent.send("a");
  await agent.send("b");
  
  expect(registerSpy).toHaveBeenCalledTimes(1);
});

it("pre_tool_call veto blocks tool execution", async () => {
  const toolHandler = vi.fn();
  const blockingPlugin: Plugin = {
    name: "blocker", version: "1.0", kind: "general",
    register(ctx) {
      ctx.registerTool({ name: "danger", inputSchema: z.object({}), handler: toolHandler });
      ctx.on("pre_tool_call", (call) => 
        call.name === "danger" ? { block: true, message: "no" } : undefined
      );
    },
  };
  
  const agent = await Agent.create({ plugins: [blockingPlugin] });
  // ... agent invokes "danger" tool
  expect(toolHandler).not.toHaveBeenCalled();
});

it("plugin cannot mutate core (sealed)", () => {
  // Em dev mode, ctx is wrapped in Proxy that prevents fora-de-API access
  const plugin: Plugin = {
    name: "naughty", version: "1.0", kind: "general",
    register(ctx) {
      expect(() => {
        (ctx as any).someInternal = "boom";
      }).toThrow(/sealed/i);
    },
  };
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/plugins/`:

- `types.ts` — `Plugin`, `PluginContext`, `HookName` types
- `manager.ts` — `PluginManager` (registers/lifecycle)
- `context.ts` — `PluginContext` impl (Proxy in dev for seal)
- `lifecycle.ts` — hook dispatching
- Public surface: `packages/sdk/src/index.ts` re-exports types

## Referências cruzadas

- [tool-registry-pattern.md](./tool-registry-pattern.md) — plugin tools + tool registry
- [provider-as-plugin.md](./provider-as-plugin.md) — model-provider plugins specific
- [forked-agent-pattern.md](./forked-agent-pattern.md) — fork inherits plugins?

## Citações primárias

- `referencia/hermes-agent/hermes_cli/plugins.py:287` — `PluginContext` Python
- `referencia/hermes-agent/AGENTS.md:467-562` — discovery systems + Teknium's hard line
- `.claude/knowledge-base/hermes-deep-dive/12-plugin-loader.md:90-145` — ADs 1-3
- v0.8 #5295 — hardcoded honcho argparse removal
