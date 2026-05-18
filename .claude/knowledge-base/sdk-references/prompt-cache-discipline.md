# Prompt Cache Discipline

> **Nunca altere context mid-conversation**. Cache-breaking força custos
> dramaticamente maiores (10x+) e degrada performance. A única exceção é
> context compression. Esse é o contrato mais load-bearing do SDK —
> violá-lo silenciosamente gera bills altas e bug reports difíceis de
> diagnosticar.

## Quando aplicar

Aplique em TODA operação que altere `messages[]` enviado ao LLM:

- `Agent.send(prompt)` — append ao final, jamais mutate anteriores
- `Agent.runUntil(goal)` — continuation injeta como user message, não muda system
- Memory recall — coloca no system prompt INICIAL, jamais re-injeta mid-turn
- Skill changes — invalida cache só na próxima sessão
- Tool registration — fixo no `Agent.create`, imutável depois

Nunca aplique para:

- Cache de embeddings (esse é outro mecanismo)
- Cache HTTP de model catalog (esse não impacta LLM cache)

## Por que importa

Anthropic, OpenAI, Gemini todos suportam prompt caching. O cache é
prefixado por **hash do conteúdo dos primeiros N tokens**. Mudar 1 byte
nos primeiros N invalida o cache → cobrança full-price para todas as
turns subsequentes.

Exemplo concreto (Anthropic cache pricing):
- Sem cache: $3/MTok input
- Com cache hit: $0.30/MTok (10x mais barato)
- Cache write (primeira vez): $3.75/MTok (25% mais caro)

Uma conversa de 50 turns com 5k tokens context cada:
- Com cache: ~$0.075 (1 write + 49 hits)
- Sem cache: ~$0.75 (50 writes)
- **10x diferença** para a mesma feature

## Discipline (do AGENTS.md:840-851)

> Hermes-Agent ensures caching remains valid throughout a conversation.
> **Do NOT implement changes that would:**
> - Alter past context mid-conversation
> - Change toolsets mid-conversation
> - Reload memories or rebuild system prompts mid-conversation
>
> Cache-breaking forces dramatically higher costs. The ONLY time we
> alter context is during context compression.

## O contrato em código

```typescript
// packages/sdk/src/agent.ts
class Agent {
  // Configuração IMUTÁVEL após Agent.create
  readonly #tools: ReadonlyArray<CustomTool>;
  readonly #skills: ReadonlyArray<Skill>;
  readonly #systemPrompt: string;
  readonly #memory: Memory;
  
  // Cache key = hash(systemPrompt + tools + skills)
  readonly #cacheKey: string;
  
  // History é APPEND-ONLY (turns adicionadas, nunca alteradas)
  readonly #messages: ReadonlyArray<SDKMessage> = [];
  
  async send(prompt: string, options?: SendOptions): Promise<Run> {
    // Append nova user message — cache anterior permanece válido
    const newMessages = [
      ...this.#messages,
      { role: "user", content: prompt },
    ];
    return this.#dispatch(newMessages);
  }
  
  // Operações que DEVEM invalidar cache → método explícito
  async invalidateCache(reason: string): Promise<void> {
    // Use deferred — aplica na próxima Agent.send
    this.#cacheInvalidationPending = { reason, at: Date.now() };
  }
}
```

## Patterns de injeção sem quebrar cache

### Pattern 1: continuation prompt como user message

`/goal` Ralph loop injeta "continue working toward the goal" como user
message, NÃO como system prompt change:

```typescript
// Agent.runUntil — injeta continuation
for await (const event of agent.runUntil(goal)) {
  // ...
  if (needsContinuation) {
    // CERTO: append user message
    await agent.send("Continue working toward: " + goal);
  } else {
    // ERRADO: mudar system prompt
    // agent.setSystemPrompt(`Goal: ${goal}\n\n${oldSystem}`);
  }
}
```

### Pattern 2: tool registry frozen on create

```typescript
// CERTO: tools imutáveis após create
const agent = await Agent.create({
  tools: [searchTool, fileTool],
});
// agent.addTool(emailTool); // ← não existe na API

// ERRADO (que evitamos): permitir mutação
// agent.tools.push(newTool); // breaks cache

// Para mudar tools: cria novo Agent
const newAgent = await Agent.create({
  tools: [searchTool, fileTool, emailTool],
});
```

### Pattern 3: memory in initial system prompt only

```typescript
// Memory recall acontece UMA vez em Agent.create
const memoryContext = await memory.recall(initialQuery);
const systemPrompt = `${baseSystem}\n\n## Context\n${memoryContext}`;

const agent = await Agent.create({
  systemPrompt, // frozen
  tools,
});

// Subsequent memory updates NÃO afetam o agent atual.
// Próximo Agent.create (próxima sessão) verá memory atualizada.
```

### Pattern 4: deferred invalidation

Slash command que muda state default para "aplica próxima sessão":

```typescript
// /add-skill new-skill
await skills.add(newSkill);
await agent.invalidateCache("new skill added"); // deferred

// Próxima Agent.create automaticamente lê new skill.
// Conversa atual continua com tools/skills antigos.

// Override: --now opta por invalidação imediata
await skills.add(newSkill, { applyNow: true });
// → força disposicão do agent atual, user precisa criar novo
```

## Failure modes prevenidos

1. **Cost regression invisível**: feature adiciona "memory recall a cada
   turn", cache invalida, custo 10x maior, ninguém nota por semanas.
   Com discipline: memory recall só no `create`, custo previsível.

2. **Latency regression**: cache hit responde em 200ms, cache miss em 2s.
   Mid-conversation invalidation degrada UX de "fluent chat" para "wait
   for it".

3. **Determinism violation em logs**: replay de conversation com cache
   sees system prompt drift, debugger não reproduz issue.

## Failure modes NÃO prevenidos

- **Cache invalidation no provider side**: Anthropic refresha cache a
  cada 5min. Se conversa demora >5min entre turns, cache expira.
  Não temos controle, só awareness.

- **Window slide quando context cap excedido**: compression é a EXCEÇÃO
  permitida. Hermes evita aggressivamente (`compression_attempts` reset,
  context budget tracking) mas eventualmente acontece.

- **System prompt deliberadamente mudado**: user faz `agent.invalidateCache()`
  intencionalmente. Pattern documenta o cost — não previne.

## Quando QUEBRAR cache é OK

- **Compression**: contexto excede max, precisa comprimir. Hermes faz
  isso com compression LLM separado, retorna mensagem compressed para
  substituir N turns velhas. CHEIO cache miss inevitável.

- **`/clear` ou `/reset`**: user opt-in. Cache miss esperado.

- **Sessão nova**: cada `Agent.create` é nova cache key. Esperado.

- **`Agent.invalidateCache({ applyNow: true })`**: user pediu explicit
  refresh. Cache miss é o ponto.

## Como testar

```typescript
it("system prompt is byte-identical across multiple sends", async () => {
  const agent = await Agent.create({ systemPrompt: "...", tools });
  const turn1 = await agent.send("hi");
  const turn2 = await agent.send("again");

  // Inspeciona as messages enviadas ao provider
  expect(turn1.context.systemPrompt).toBe(turn2.context.systemPrompt);
});

it("tool schemas don't drift between sends", async () => {
  const agent = await Agent.create({ tools: [tool1, tool2] });
  const t1 = await agent.send("a");
  const t2 = await agent.send("b");
  
  expect(JSON.stringify(t1.context.tools)).toBe(JSON.stringify(t2.context.tools));
});

it("memory recall happens once on create, not per send", async () => {
  const recallSpy = vi.spyOn(memory, "recall");
  const agent = await Agent.create({ memory });
  await agent.send("a");
  await agent.send("b");
  await agent.send("c");
  
  expect(recallSpy).toHaveBeenCalledTimes(1); // recall on create, not per turn
});

it("invalidateCache is deferred (does not affect current conv)", async () => {
  const agent = await Agent.create({ tools: [tool1] });
  await agent.send("a");
  await agent.invalidateCache("test");
  await agent.send("b");
  
  // Both sends saw the same tools[]
  expect(agent.context.tools).toEqual([tool1]);
});
```

## Failure mode famoso: `<think>` blocks (Hermes v0.2 #174)

DeepSeek e Qwen emitem `<think>...</think>` blocks como CoT. Hermes
v0.2 inicialmente armazenava esses no message history. Resultado:
cada turn adicionava ~5k tokens de thinking, cache invalidava a cada
turn (history mudava de shape).

Fix: stripar `<think>` blocks ANTES de adicionar ao message history.
Persistir só o `content` user-visible.

Lesson para SDK: ao integrar new providers, **audite o response shape**.
Qualquer per-turn unique content (timestamps, random IDs, IPs) que entra
no message history quebra cache.

## Onde wirar no SDK

`packages/sdk/src/agent.ts`:

- `Agent.create` recebe tools/skills/memory readonly → freeze
- `Agent.send` é append-only, never mutates
- `Agent.invalidateCache(reason, options?)` — deferred ou imediata

Validação em runtime (dev only):

```typescript
// packages/sdk/src/internal/cache-discipline-guard.ts
export function assertSystemPromptStable(
  before: string,
  after: string,
  reason: string,
): void {
  if (process.env.NODE_ENV !== "production" && before !== after) {
    console.warn(
      `[theokit] System prompt changed mid-conversation. ` +
        `This will invalidate prompt cache (10x cost regression). ` +
        `Reason: ${reason}`,
    );
  }
}
```

## Referências cruzadas

- [compression-death-spiral.md](./compression-death-spiral.md) — única exceção permitida
- [tool-call-failure-recovery.md](./tool-call-failure-recovery.md) — `<think>` blocks
- [forked-agent-pattern.md](./forked-agent-pattern.md) — fork inherits cache key

## Citações primárias

- `referencia/hermes-agent/AGENTS.md:840-851` — discipline rule
- `referencia/hermes-agent/AGENTS.md:849-851` — deferred invalidation pattern
- `.claude/knowledge-base/hermes-deep-dive/00-orientation.md:135-148` — section "Caching the system prompt is non-negotiable"
- v0.4 #2282 — gateway prompt caching: AIAgent cached per session
- v0.7 #3991 — deterministic `call_id` fallbacks for cache consistency
