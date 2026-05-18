# Compression Death Spiral

> Context compression é a única operação permitida que muta past
> messages (per [prompt-cache-discipline.md](./prompt-cache-discipline.md)).
> Mas compression mal-implementada cria **loops infinitos**: compression
> dispara → falha → contexto ainda excede limite → compression dispara
> de novo. Hermes shipou e fixou esse spiral 3 vezes. Esse doc é o
> playbook para evitar.

## Quando aplicar

Aplique em features que comprimem ou rotacionam context:

- `Agent.send` quando token budget excede max
- Memory consolidation que cria summaries
- Session rotation quando session.messages cresce demais
- Any "summary as compression" pattern

## Spirals reais que Hermes shipou

| PR | Versão | Spiral |
|---|---|---|
| v0.4 #1723 | v0.4 | `compression_attempts` never resets → infinite |
| v0.7 #4750 (closes #2153) | v0.7 | Compression triggers → fails → triggers again |
| v0.11 #10065 | v0.11 | Stale agent timeout, empty response after tools → spiral |
| v0.11 #10472 | v0.11 | Empty-tools after tools, premature loop exit on weak models |

4 distinct spiral modes shipados em produção. Cada um custou
diagnóstico difícil porque o sintoma é "agent travado, custo subindo".

## O pattern do spiral

```
Turn N: context = 90% of limit
  ├─ Compression triggered
  ├─ Compression LLM call: 20k tokens out
  ├─ But: compressed result reincludes recent messages (intent: continuity)
  └─ context = 95% of limit  ← STILL OVER
  
Turn N+1: context = 95%, ainda excede
  ├─ Compression triggered AGAIN
  ├─ Compression LLM call: 20k tokens
  ├─ Result similar
  └─ context = 96% of limit
  
Turn N+2: ...

[Loops forever, $200 of API calls later, user notices]
```

Root causes que ENABLE o spiral:

1. **`compression_attempts` counter nunca reseta** (#1723)
2. **Compression output > compression input** (rare mas acontece com chatty summarizer LLMs)
3. **Empty-tool-result inflando context** (#10065)
4. **Trigger threshold == failure threshold** (não há margem)

## Defenses canonical (composables)

### Defense 1: budget tracking explícito

```typescript
// packages/sdk/src/internal/runtime/budget.ts
export class IterationBudget {
  #remaining: number;
  #total: number;
  #compressionAttempts: number = 0;
  readonly #maxCompressionsPerSession: number;

  constructor(total: number, maxCompressionsPerSession = 3) {
    this.#remaining = total;
    this.#total = total;
    this.#maxCompressionsPerSession = maxCompressionsPerSession;
  }

  get remaining() { return this.#remaining; }
  get compressionAttempts() { return this.#compressionAttempts; }
  
  consume(amount: number = 1): void {
    this.#remaining -= amount;
  }

  recordCompression(): { allowed: boolean; reason?: string } {
    if (this.#compressionAttempts >= this.#maxCompressionsPerSession) {
      return {
        allowed: false,
        reason: `compression cap reached (${this.#maxCompressionsPerSession} per session)`,
      };
    }
    this.#compressionAttempts += 1;
    return { allowed: true };
  }
}
```

Hard cap: max 3 compressions por session. Se passar disso, o spiral
está acontecendo — fail loud, peça user para resetar.

### Defense 2: compression precisa REDUZIR

```typescript
async function compressContext(
  messages: SDKMessage[],
  budget: IterationBudget,
): Promise<SDKMessage[]> {
  const cap = budget.recordCompression();
  if (!cap.allowed) {
    throw new CompressionExhaustedError(cap.reason!);
  }

  const beforeTokens = countTokens(messages);
  const compressed = await runCompressionLLM(messages);
  const afterTokens = countTokens(compressed);

  // Sanity check: compression que NÃO reduz é spiral em formação
  const reductionPct = ((beforeTokens - afterTokens) / beforeTokens) * 100;
  if (reductionPct < 10) {
    throw new CompressionIneffectiveError(
      `compression reduced ${reductionPct.toFixed(1)}% (< 10% min). ` +
        `Spiral likely.`,
    );
  }

  return compressed;
}
```

10% min reduction é arbitrário mas previne "compression empilha,
nunca reduz".

### Defense 3: compression em SLOT específico

Compress só nas messages **antigas**, preserva últimas N **inalteradas**:

```typescript
function selectCompressionWindow(
  messages: SDKMessage[],
  preserveLast: number = 6,
): { toCompress: SDKMessage[]; toPreserve: SDKMessage[] } {
  if (messages.length <= preserveLast) {
    return { toCompress: [], toPreserve: messages };
  }
  return {
    toCompress: messages.slice(0, -preserveLast),
    toPreserve: messages.slice(-preserveLast),
  };
}
```

Última 6 turns sempre inalteradas. Compression atua só nas N-6
turns mais antigas. Resultado:

```
[ compressed_summary_of_old, recent_1, recent_2, ..., recent_6 ]
```

### Defense 4: empty-response detection (v0.11 #10472)

Weak models às vezes retornam `content: ""` após tool call. Sem
detection, esses entram no history, inflam context sem valor.

```typescript
function validateResponse(response: ProviderResponse): {
  ok: boolean;
  reason?: string;
} {
  if (response.content === "" && (response.toolCalls?.length ?? 0) === 0) {
    return {
      ok: false,
      reason: "empty response with no tool calls (model bailout)",
    };
  }
  return { ok: true };
}

// Loop:
const response = await provider.complete(messages);
const validation = validateResponse(response);
if (!validation.ok) {
  budget.consume();
  if (budget.remaining <= 0) {
    throw new EmptyResponseSpiralError(validation.reason!);
  }
  // Continue loop with a nudge
  messages.push({
    role: "user",
    content: "(continue or end with a final answer)",
  });
  continue;
}
```

### Defense 5: counters reset entre sessions

```typescript
// Quando Agent.create
new IterationBudget({
  total: options.maxIterations ?? 90,
  maxCompressionsPerSession: options.maxCompressions ?? 3,
});
// Cada Agent.create → counters limpos. Sem state leak across sessions.
```

### Defense 6: grace call (Hermes pattern)

> "The loop runs while api_call_count < max_iterations and 
> iteration_budget.remaining > 0 — OR self._budget_grace_call is True"
> (AGENTS.md:84-140)

Uma chamada extra permitida depois do budget esgotado, dá ao agent
chance de emitir final answer:

```typescript
let graceCallUsed = false;

while (budget.remaining > 0 || !graceCallUsed) {
  if (budget.remaining <= 0) {
    graceCallUsed = true;
    // Last chance — agent deve emitir final answer ou loop encerra
  }
  
  const response = await provider.complete(messages);
  if (!response.toolCalls?.length) {
    return response.content; // final answer
  }
  
  // Tool call — execute, append, decrement
  await executeTools(response.toolCalls);
  budget.consume();
}

throw new IterationBudgetExhaustedError("max iterations + grace call exhausted");
```

## Failure modes prevenidos

1. **Infinite compression**: `compression_attempts` cap previne.
2. **Compression que adiciona tokens**: 10% min reduction check previne.
3. **Empty-response inflation**: `validateResponse` rejects, count consumes.
4. **State leak across sessions**: counters em Budget object scoped to Agent.

## Failure modes NÃO prevenidos

- **Compression LLM caro**: chamadas de compression usam o auxiliary
  model, mas se aux é caro mesmo (Opus 4 instead of Haiku), custo
  acumula. Não previne — só limita a 3 ataques por session.

- **User intencionalmente longo**: user manda 200 messages super-longas
  numa session. Compression inevitável e barato relativo à conversação.
  Não é spiral, é uso normal.

- **Provider charging error**: cache TTL expirou, todo turn é cache write
  full-price. Diferente do spiral mas mesmo sintoma de "custo subindo
  inesperado".

## Quando NÃO comprimir

- **Curto histórico** (< 50% of limit): nenhum benefício, só latência.
- **Session crítica que requer determinism**: replay, debug, audit. User
  explicit `agent.disableCompression()`.
- **Final turn esperado**: agent quase em final answer; compression
  desperdiça turn.

## Como testar

```typescript
it("compression cap rejects 4th compression", async () => {
  const budget = new IterationBudget(100, 3);
  expect(budget.recordCompression().allowed).toBe(true);
  expect(budget.recordCompression().allowed).toBe(true);
  expect(budget.recordCompression().allowed).toBe(true);
  expect(budget.recordCompression().allowed).toBe(false);
});

it("compression that doesn't reduce throws ineffective error", async () => {
  vi.mocked(runCompressionLLM).mockResolvedValue(largeNoReductionMessages);
  await expect(compressContext(messages, budget)).rejects.toThrow(/spiral likely/);
});

it("empty response with no tool calls is detected", () => {
  const r = validateResponse({ content: "", toolCalls: [] });
  expect(r.ok).toBe(false);
});

it("grace call gives agent last chance after budget exhausted", async () => {
  const budget = new IterationBudget(1, 3);
  budget.consume(); // remaining = 0
  
  // Loop should still allow ONE more call (grace)
  const calls = [];
  while (budget.remaining > 0 || !calls.includes("grace")) {
    if (budget.remaining <= 0) calls.push("grace");
    else calls.push("normal");
    budget.consume();
  }
  expect(calls).toEqual(["normal", "grace"]);
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/runtime/`:

- `budget.ts` — `IterationBudget`, `CompressionExhaustedError`, `CompressionIneffectiveError`
- `compression.ts` — `compressContext`, `selectCompressionWindow`
- `validate-response.ts` — `validateResponse`
- `agent-loop.ts` — loop com grace call

## Referências cruzadas

- [prompt-cache-discipline.md](./prompt-cache-discipline.md) — compression é a única exceção
- [tool-call-failure-recovery.md](./tool-call-failure-recovery.md) — empty response + tool result tracking
- [error-context-surfacing.md](./error-context-surfacing.md) — `CompressionExhaustedError` precisa de mensagem útil

## Citações primárias

- `referencia/hermes-agent/AGENTS.md:84-140` — synchronous loop com budget + grace call
- v0.4 #1723, v0.7 #4750, v0.11 #10065, v0.11 #10472 — 4 spirals fixados
- `.claude/knowledge-base/hermes-deep-dive/00-orientation.md:225-229` — section "Compression death spirals"
