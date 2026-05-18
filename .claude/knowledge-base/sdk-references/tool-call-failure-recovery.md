# Tool Call Failure Recovery

> Models hallucinate tool calls. Tool args came as strings ("3" instead
> of `3`). Tool names came uppercased ("SEARCH" not "search"). Models
> described intent ("I'll call search...") instead of CALLING. Cada um
> desses é um failure mode shipado em produção pelo Hermes — middleware
> de repair previne crash, retry, log explícito.

## Quando aplicar

Aplique em qualquer SDK que faz tool calls via LLM:

- `Agent.send` que dispatcha tools
- `Agent.streamObject` via synthetic forced tool
- MCP tool dispatch
- Subagent (kanban worker, background review) tool calls

## Failure modes que Hermes já viu

Tabela compacta de PRs históricos (fonte: `hermes-deep-dive/00-orientation.md:215-223`):

| PR | Failure mode | Recovery |
|---|---|---|
| v0.2 #444 | DeepSeek V3 dropping multi-line JSON tool args | Coerce + reparse |
| v0.3 #1300 | DeepSeek V3 multiple parallel tool calls (only first executed) | Iterate all `tool_calls` array |
| v0.5 #5414, #5931 | GPT/Codex describing actions instead of calling | Re-prompt with explicit "use the tool" |
| v0.8 #6120 | Codex tool-use guidance via self-benchmarking | Provider-specific tool prompt |
| v0.9 #6847 | Truncated streaming tool call detection | Validate JSON before dispatch |
| v0.2 | Tool call repair middleware — auto-lowercase | Case-insensitive match |
| v0.2 | Invalid tool handler | Return error to LLM, allow retry |
| v0.8 #5265 | Coerce tool arg types to match JSON Schema | Type coercion before validate |
| v0.13 #20232 | Worker-created-card hallucination gate (kanban) | Verify side effect actually happened |
| v0.2 #174 + many | `<think>` blocks polluting responses | Strip before message history |

**10+ distinct failure modes**. Não previsíveis sem ter visto na prática.

## Pattern: repair middleware (Hermes-style)

```typescript
// packages/sdk/src/internal/tool-dispatch/repair-middleware.ts
import { ZodError, ZodSchema } from "zod";

interface ToolCall {
  name: string;
  args: unknown;
  id: string;
}

interface RepairResult {
  call: ToolCall;
  repairs: string[]; // log do que foi fixado
}

export function repairToolCall(
  raw: ToolCall,
  registry: Map<string, { name: string; schema: ZodSchema }>,
): RepairResult {
  const repairs: string[] = [];
  let call = { ...raw };

  // Repair 1: case-insensitive name match
  if (!registry.has(call.name)) {
    const lower = call.name.toLowerCase();
    const match = Array.from(registry.keys()).find(
      (k) => k.toLowerCase() === lower,
    );
    if (match !== undefined) {
      repairs.push(`name: "${call.name}" → "${match}"`);
      call.name = match;
    }
  }

  // Repair 2: args came as string (some providers stringify)
  if (typeof call.args === "string") {
    try {
      call.args = JSON.parse(call.args);
      repairs.push("args: parsed from string");
    } catch {
      // leave for validator to reject
    }
  }

  // Repair 3: type coercion against schema (v0.8 #5265)
  const tool = registry.get(call.name);
  if (tool !== undefined && typeof call.args === "object" && call.args !== null) {
    const coerced = coerceArgsToSchema(call.args, tool.schema);
    if (coerced.changed.length > 0) {
      call.args = coerced.value;
      repairs.push(...coerced.changed.map((c) => `args.${c}`));
    }
  }

  return { call, repairs };
}

function coerceArgsToSchema(
  args: Record<string, unknown>,
  schema: ZodSchema,
): { value: Record<string, unknown>; changed: string[] } {
  const changed: string[] = [];
  const out: Record<string, unknown> = {};

  // Zod 4 supports .safeParse + introspection
  for (const [key, val] of Object.entries(args)) {
    if (typeof val === "string") {
      // Try parse "3" → 3, "true" → true, "[1,2]" → array
      const asNumber = Number(val);
      if (!Number.isNaN(asNumber) && val.trim().match(/^-?\d+(\.\d+)?$/)) {
        out[key] = asNumber;
        changed.push(`${key}: string→number`);
        continue;
      }
      if (val === "true" || val === "false") {
        out[key] = val === "true";
        changed.push(`${key}: string→boolean`);
        continue;
      }
      try {
        const parsed = JSON.parse(val);
        if (typeof parsed === "object") {
          out[key] = parsed;
          changed.push(`${key}: string→object`);
          continue;
        }
      } catch {
        // Não é JSON, manter string
      }
    }
    out[key] = val;
  }

  return { value: out, changed };
}
```

## Pattern: `<think>` block stripping

DeepSeek/Qwen emitem chain-of-thought no `content`. Cache discipline
([prompt-cache-discipline.md](./prompt-cache-discipline.md)) requer que
isso NÃO entre no history:

```typescript
// packages/sdk/src/internal/tool-dispatch/strip-think.ts
const THINK_PATTERN = /<think>[\s\S]*?<\/think>\s*/g;

export function stripThinkBlocks(content: string): {
  visible: string;
  thinking: string | null;
} {
  const matches = [...content.matchAll(THINK_PATTERN)];
  const thinking = matches.length > 0
    ? matches.map((m) => m[0]).join("\n").replace(/<\/?think>/g, "").trim()
    : null;
  const visible = content.replace(THINK_PATTERN, "").trim();
  return { visible, thinking };
}
```

Onde usar: imediatamente após receber response, antes de append no
history. `thinking` pode ser exposto via SDKThinkingMessage para o
consumer (opt-in display) mas NÃO entra em `messages[]`.

## Pattern: validate-then-dispatch

```typescript
// packages/sdk/src/internal/tool-dispatch/dispatch.ts
export async function dispatchTool(
  raw: ToolCall,
  registry: Map<string, ToolDef>,
): Promise<ToolResult> {
  // 1. Repair
  const { call, repairs } = repairToolCall(raw, registry);
  if (repairs.length > 0) {
    log("info", `Tool call repaired: ${repairs.join(", ")}`, {
      original: raw,
      repaired: call,
    });
  }

  // 2. Lookup
  const tool = registry.get(call.name);
  if (tool === undefined) {
    // Return error to LLM (let it retry with valid name)
    return {
      call_id: call.id,
      isError: true,
      content: `Unknown tool: "${call.name}". Available: ${[...registry.keys()].join(", ")}`,
    };
  }

  // 3. Validate args
  const parsed = tool.schema.safeParse(call.args);
  if (!parsed.success) {
    return {
      call_id: call.id,
      isError: true,
      content: `Invalid arguments for "${call.name}": ${parsed.error.message}`,
    };
  }

  // 4. Execute
  try {
    const result = await tool.handler(parsed.data);
    return { call_id: call.id, isError: false, content: result };
  } catch (err) {
    return {
      call_id: call.id,
      isError: true,
      content: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

**Key insight**: tool errors são DEVOLVIDOS PARA O LLM, não throw para o
caller. Isso permite que o LLM:

1. Veja o erro
2. Tente outra abordagem (diferente args, diferente tool, ou desistir)
3. Comunicar ao user que algo deu errado

Throw quebra a conversação; return error mantém o loop.

## Pattern: hallucination gate (side-effect verification)

LLM diz "I created card X and Y". Hermes verifica que X e Y de fato
existem no DB antes de aceitar completion (kanban v0.13 #20232):

```typescript
// Pattern (não SDK-level, mas reutilizável):
async function verifyHallucinationGate<T>(
  claimed: ClaimedResult<T>,
  verify: (id: T) => Promise<boolean>,
): Promise<{ verified: T[]; phantom: T[] }> {
  const verified: T[] = [];
  const phantom: T[] = [];
  for (const id of claimed.createdIds) {
    if (await verify(id)) verified.push(id);
    else phantom.push(id);
  }
  return { verified, phantom };
}

// Uso em feature autonoma:
const completion = await agent.send("Create the cards X, Y, Z");
const { verified, phantom } = await verifyHallucinationGate(
  completion.claimed,
  (id) => kanban.taskExists(id),
);
if (phantom.length > 0) {
  // Re-prompt: "You claimed to create [phantom] but they don't exist. Try again."
}
```

## Failure modes prevenidos

1. **`UnknownToolError` em runtime quando model uppercase**: provider
   retorna `"SEARCH"`, registry tem `"search"`, crash.
   Com case-insensitive repair: match, log info, dispatch.

2. **`InvalidArgumentsError` para args stringificados**: provider passa
   `args: '{"q": "foo"}'` (string) em vez de `{q: "foo"}` (object).
   Com JSON.parse repair: dispatched OK.

3. **Type coercion**: model emite `count: "3"` (string), schema espera
   `count: number`.
   Com coerceArgsToSchema: converte, dispatched, log.

4. **Cache invalidation por `<think>` no history**: cada turn adiciona
   5k thinking tokens, cache miss every turn, 10x cost.
   Com stripThinkBlocks: history limpo, cache stable.

5. **Falsa completion**: LLM diz "I deleted file X" sem chamar `delete`
   tool. Sem verification: state file system permanece, agent acha que
   trabalho foi feito.
   Com hallucination gate: verifica side effect, re-prompts se phantom.

## Failure modes NÃO prevenidos

- **Argumentos semanticamente errados**: schema valida shape mas não
  semântica. Tool recebe `path: "/etc/passwd"` quando devia ser
  `"/tmp/work.txt"`. Defesa: sandbox/permission layer separado.

- **Tool call ausente**: model decide não chamar tool quando devia. Sem
  forçar — só re-prompt heurística (v0.5 #5414).

- **Hallucinated tool name**: model invent `"file_write"` quando registry
  tem só `"write_file"`. Levenshtein-distance match poderia ajudar mas
  pode mascarar bugs reais. Hermes NÃO faz fuzzy match — rejeita e
  retorna available list.

## Quando NÃO repair

- **In production with verification critical**: financial transactions,
  permission checks. Reject rather than repair — silent fixes mascaram
  bugs.

- **Testes**: tests devem assertar exact behavior. Repair em test setup
  esconde regressions.

## Como testar

```typescript
it("case-insensitive tool name match", async () => {
  const registry = new Map([["search", { name: "search", schema: z.object({q: z.string()}) }]]);
  const { call, repairs } = repairToolCall({ name: "SEARCH", args: { q: "foo" }, id: "1" }, registry);
  expect(call.name).toBe("search");
  expect(repairs).toContain('name: "SEARCH" → "search"');
});

it("parses stringified args", async () => {
  const { call, repairs } = repairToolCall(
    { name: "search", args: '{"q":"foo"}', id: "1" },
    new Map([["search", { name: "search", schema: z.object({q: z.string()}) }]]),
  );
  expect(call.args).toEqual({ q: "foo" });
  expect(repairs).toContain("args: parsed from string");
});

it("coerces string number to number", async () => {
  const { call, repairs } = repairToolCall(
    { name: "limit", args: { count: "10" }, id: "1" },
    new Map([["limit", { name: "limit", schema: z.object({count: z.number()}) }]]),
  );
  expect(call.args).toEqual({ count: 10 });
  expect(repairs).toContain("count: string→number");
});

it("strips <think> blocks", () => {
  const r = stripThinkBlocks("<think>reasoning here</think>Actual answer.");
  expect(r.visible).toBe("Actual answer.");
  expect(r.thinking).toBe("reasoning here");
});

it("returns error to LLM on unknown tool, doesn't throw", async () => {
  const result = await dispatchTool(
    { name: "nonexistent", args: {}, id: "1" },
    new Map(),
  );
  expect(result.isError).toBe(true);
  expect(result.content).toMatch(/Unknown tool/);
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/tool-dispatch/`:

- `repair-middleware.ts` — `repairToolCall`, `coerceArgsToSchema`
- `strip-think.ts` — `stripThinkBlocks`
- `dispatch.ts` — `dispatchTool` (repair → validate → execute)
- Callers: `internal/runtime/local-run.ts`, qualquer subagent

## Referências cruzadas

- [prompt-cache-discipline.md](./prompt-cache-discipline.md) — `<think>` stripping
- [forked-agent-pattern.md](./forked-agent-pattern.md) — repair também em forks
- [error-context-surfacing.md](./error-context-surfacing.md) — formato do error que vai pro LLM

## Citações primárias

- `.claude/knowledge-base/hermes-deep-dive/00-orientation.md:215-223` — list of failure modes
- v0.2 #444 (DeepSeek JSON), v0.3 #1300 (parallel calls), v0.8 #5265 (type coerce)
- v0.13 #20232 — hallucination gate em kanban
- v0.2 #174 — `<think>` block stripping origin
