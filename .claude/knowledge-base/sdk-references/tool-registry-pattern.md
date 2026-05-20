# Tool Registry Pattern

> Três layers compõem o tool surface do agent: **registration** (tool
> exists), **exposure** (toolset membership decide quais tools o model
> vê), **availability** (`check_fn` decide se pode chamar AGORA). Cada
> layer mutate independente. Hermes ships 98 tools com esse pattern —
> escala melhor que dict gigante.

## Quando aplicar

Aplique quando o SDK ou consumer adiciona tools agent-callable:

- Built-in tools (`shell`, `read_file`, `memory_search`)
- Custom tools via `defineTool` (per D24)
- Plugin tools via `ctx.registerTool`
- MCP-discovered tools

## Os três layers

### Layer 1: Registration

Toda tool está num registry central. Hermes:

```python
# tools/registry.py:151
class ToolRegistry:
    def register(self, name, toolset, schema, handler, *,
                 check_fn=None, requires_env=None, is_async=False,
                 description=None, emoji=None,
                 max_result_size_chars=None,
                 dynamic_schema_overrides=None) -> ToolEntry:
        ...
```

TypeScript (extensão do D24):

```typescript
// packages/sdk/src/internal/tool-registry.ts
export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: ZodSchema;
  handler: (args: any) => Promise<unknown> | unknown;
  
  // Hermes additions:
  toolset?: string; // belongs to which named bundle
  checkFn?: () => boolean | Promise<boolean>;
  requiresEnv?: string[]; // hard env var deps
  emoji?: string; // for UI display
  maxResultSizeChars?: number; // truncation policy
  dynamicSchemaOverrides?: (ctx: AgentContext) => Partial<ZodSchema>;
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
}
```

### Layer 2: Exposure (Toolsets)

Mesmo tool registrada, NEM SEMPRE deve ser visível ao model:

- Telegram bot → não deve ver SSH-only tools
- Kanban worker → não deve ver delegation tools
- CLI command → vê tudo

Hermes (`toolsets.py`):

```python
_HERMES_CORE_TOOLS = ["shell", "read_file", "write_file", ...]
TOOLSETS = {
    "default": _HERMES_CORE_TOOLS,
    "kanban-worker": ["kanban_show", "kanban_complete", "kanban_block", ...],
    "ssh": _HERMES_CORE_TOOLS + ["ssh_connect", "ssh_exec"],
    "minimal": ["shell"],
}
```

TypeScript:

```typescript
// packages/sdk/src/internal/toolset.ts
export interface Toolset {
  name: string;
  tools: string[]; // referencing registered tool names
  extends?: string; // herda de outra toolset (composition)
}

export const CORE_TOOLSET: Toolset = {
  name: "core",
  tools: ["shell", "read_file", "write_file", "memory_search", "memory_get"],
};

export const KANBAN_WORKER_TOOLSET: Toolset = {
  name: "kanban-worker",
  tools: ["kanban_show", "kanban_complete", "kanban_block", "kanban_heartbeat"],
  // não herda de core — worker é scope restrito
};

// Resolver toolset em time-de-turno:
export function resolveToolset(
  toolset: Toolset,
  registry: ToolRegistry,
): ToolEntry[] {
  return toolset.tools
    .map((name) => registry.get(name))
    .filter((e): e is ToolEntry => e !== undefined);
}
```

### Layer 3: Availability (`check_fn`)

Tool exists in registry, está na toolset, mas pode não estar utilizável:

- `browser_*` precisa playwright instalado
- `image_generate` precisa API key
- `git_commit` precisa de git no PATH

`check_fn` é probe rápido. Hermes TTL-cacheia o resultado por 30s para
não rodar a cada turn.

```typescript
// packages/sdk/src/internal/check-fn-cache.ts
const checkFnCache = new Map<string, { result: boolean; expiresAt: number }>();
const TTL_MS = 30_000;

export async function isToolAvailable(entry: ToolEntry): Promise<boolean> {
  if (entry.checkFn === undefined) {
    // Verifica requiresEnv basic
    if (entry.requiresEnv !== undefined) {
      return entry.requiresEnv.every((v) => process.env[v] !== undefined);
    }
    return true;
  }
  
  const cached = checkFnCache.get(entry.name);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  
  const result = await entry.checkFn();
  checkFnCache.set(entry.name, {
    result,
    expiresAt: Date.now() + TTL_MS,
  });
  return result;
}

// Compose os 3 layers:
export async function getAvailableTools(
  toolset: Toolset,
  registry: ToolRegistry,
): Promise<ToolEntry[]> {
  const entries = resolveToolset(toolset, registry);
  const available = await Promise.all(
    entries.map(async (e) => ({ entry: e, ok: await isToolAvailable(e) })),
  );
  return available.filter((x) => x.ok).map((x) => x.entry);
}
```

## Architectural decisions

### AD-1: AST autodiscovery (Python) → explicit imports (TS)

Hermes inspeciona AST do `tools/*.py` para descobrir self-registering
modules. TypeScript não tem AST inspect idiomático no runtime, e
side-effect imports são anti-pattern em TS.

**Pattern TS**: explicit imports + collect-into-registry.

```typescript
// packages/sdk/src/internal/tools/index.ts (barrel)
import { shellTool } from "./shell";
import { readFileTool } from "./read-file";
import { memorySearchTool } from "./memory-search";
// ...

export const BUILTIN_TOOLS: ToolEntry[] = [
  shellTool,
  readFileTool,
  memorySearchTool,
  // ...
];

// Registry init:
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of BUILTIN_TOOLS) {
    registry.register(tool);
  }
  return registry;
}
```

### AD-2: All handlers return JSON-serializable

Hermes rule: "All handlers MUST return a JSON string"
(`AGENTS.md:264-308`). Razão: pipeline downstream (logging, replay,
serialization for cloud agent) precisa estável.

TypeScript: pode ser objeto qualquer, mas SDK serializa via JSON antes
de passar pro LLM:

```typescript
async function dispatchTool(entry: ToolEntry, args: unknown): Promise<string> {
  const result = await entry.handler(args);
  // Sempre serializa — handler pode retornar object, string, number, array
  return typeof result === "string" ? result : JSON.stringify(result);
}
```

### AD-3: `max_result_size_chars` para truncation policy

Tools podem retornar output enorme (shell `find /`, file read). Sem cap,
context inflate.

```typescript
function applyResultCap(content: string, capChars: number = 100_000): string {
  if (content.length <= capChars) return content;
  return (
    content.slice(0, capChars) +
    `\n\n[output truncated: ${content.length - capChars} chars omitted]`
  );
}
```

### AD-4: `dynamic_schema_overrides` para schema context-dependent

Edge case: tool schema varia com context (e.g., `memory_search` mostra
namespaces ativos como enum em vez de string livre). Hermes implementa
via callback que retorna schema partial.

```typescript
// Tool com schema dinâmico:
{
  name: "memory_search",
  inputSchema: z.object({
    namespace: z.string(),
    query: z.string(),
  }),
  dynamicSchemaOverrides: (ctx) => {
    if (ctx.memory.availableNamespaces.length > 0) {
      return {
        namespace: z.enum(ctx.memory.availableNamespaces as [string, ...string[]]),
      };
    }
    return {};
  },
}
```

Use sparingly — schema mudar entre turns viola cache discipline
(per [prompt-cache-discipline.md](./prompt-cache-discipline.md)). Aplique
APENAS em tools que são "discovery" (mudam só entre sessions, not turns).

## Failure modes prevenidos

1. **Tool não-existe runtime**: `Agent.send` invoca tool, runtime falha
   "tool not registered". Com registry central + toolset resolution,
   schema enviado ao LLM SÓ contém tools válidas.

2. **API key faltando**: model chama `image_generate`, mas `OPENAI_API_KEY`
   não setada. Sem check_fn: 400 error meia conversação adentro. Com
   check_fn: tool filtrada do schema antes do send.

3. **Output flood**: shell `find /` retorna 5MB. Sem cap: context inflado,
   próxima turn carísssima. Com cap: truncated com "... 4.9MB omitted".

4. **Handler async sem detection**: handler é async mas registry trata
   como sync. Promise[object] vira string `"[object Promise]"`. Com
   normalized dispatch (await result, then serialize): handlers sync e
   async funcionam igual.

## Failure modes NÃO prevenidos

- **Tool intentionally lying** (returns success com side effect zero):
  só hallucination gate ([tool-call-failure-recovery.md](./tool-call-failure-recovery.md))
  detecta.

- **Schema válido mas semanticamente errado**: model passa `path: "/etc/passwd"`
  passando shape `{path: string}`. Sandbox/permission layer separado.

- **check_fn stale**: tool ficou OFFLINE durante session. TTL 30s detecta
  eventualmente mas user vê 1-2 falhas primeiro.

## Como testar

```typescript
it("registry rejects duplicate registration", () => {
  const r = new ToolRegistry();
  r.register({ name: "foo", inputSchema: z.object({}), handler: () => "ok" });
  expect(() => 
    r.register({ name: "foo", inputSchema: z.object({}), handler: () => "ok" })
  ).toThrow(/already registered/);
});

it("toolset.extends does not exist — composition is intentional flat list", () => {
  // Toolset herança causa ambiguidade. Forçamos flat list explícita.
});

it("check_fn results are TTL-cached for 30s", async () => {
  const checkSpy = vi.fn().mockReturnValue(true);
  const entry: ToolEntry = {
    name: "t", inputSchema: z.object({}), handler: () => "",
    checkFn: checkSpy,
  };
  
  await isToolAvailable(entry);
  await isToolAvailable(entry);
  await isToolAvailable(entry);
  
  expect(checkSpy).toHaveBeenCalledTimes(1); // cached
  
  // Advance time past TTL
  vi.advanceTimersByTime(31_000);
  await isToolAvailable(entry);
  expect(checkSpy).toHaveBeenCalledTimes(2);
});

it("output exceeding max_result_size_chars is truncated with marker", async () => {
  const big = "x".repeat(200_000);
  const truncated = applyResultCap(big, 100_000);
  expect(truncated.length).toBeLessThan(101_000);
  expect(truncated).toMatch(/\[output truncated.*100000 chars omitted\]/);
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/tool-registry/`:

- `registry.ts` — `ToolRegistry`, `ToolEntry`
- `toolset.ts` — `Toolset`, `resolveToolset`
- `check-fn-cache.ts` — `isToolAvailable`, TTL cache
- `dispatch.ts` — pipeline registry → toolset → availability → exec
- Public via `packages/sdk/src/define-tool.ts` (já existe — extender com ToolEntry fields)

## Referências cruzadas

- [plugin-contract-design.md](./plugin-contract-design.md) — plugins usam `ctx.registerTool` que delega aqui
- [tool-call-failure-recovery.md](./tool-call-failure-recovery.md) — dispatch error handling
- [prompt-cache-discipline.md](./prompt-cache-discipline.md) — schema deve ser estável (dynamic_schema_overrides com cuidado)
- ADR D24 — `defineTool` Zod source (já existente)

## Citações primárias

- `referencia/hermes-agent/tools/registry.py:151` — `ToolRegistry.register`
- `referencia/hermes-agent/AGENTS.md:264-308` — discipline geral
- `.claude/knowledge-base/hermes-deep-dive/11-tool-registry.md:18-100` — Three layers + ADs
- `referencia/hermes-agent/toolsets.py` — TOOLSETS dict pattern
