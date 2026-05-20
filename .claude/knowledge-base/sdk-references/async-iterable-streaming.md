# AsyncIterable Streaming Pattern

> Quando o SDK precisa expor um loop com control (pause, resume, cancel,
> inspect mid-progress), retorne `AsyncIterable<DiscriminatedEvent>`.
> Esse pattern é idiomatic TypeScript, suporta `for-await-of` natural,
> e permite o consumer filtrar/transformar events. Hermes' `/goal`
> Ralph loop é exatamente isso em Python; TS port = `Agent.runUntil(goal)`
> returning AsyncIterable<GoalEvent>.

## Quando aplicar

Aplique quando o SDK expõe operação:

- Multi-step com progresso visível ao consumer
- Long-running com pause/resume/cancel
- Eventos discretos que o consumer pode quer filtrar
- Streaming LLM output + tool calls + decisions

Exemplos canônicos:

- `Agent.streamObject` (já existe — D39) — partials + complete
- `Agent.runUntil(goal)` — Ralph loop com judge verdicts
- `Memory.consolidate()` — passes de dreaming
- `Kanban.observeBoard()` — task transitions

Não aplique quando:

- Operação é single-shot (use `Promise<T>`)
- Não há control state pra inspect (use callback simples)
- Result não-streamable (use return + result)

## Pattern canonical (TypeScript-native)

Discriminated event types:

```typescript
// packages/sdk/src/types/goal-events.ts
export type GoalEvent =
  | { type: "turn_start"; turn: number; goal: string }
  | { type: "agent_response"; turn: number; content: string }
  | { type: "judge_verdict"; turn: number; verdict: "done" | "continue" | "skipped"; reason: string }
  | { type: "continuation"; turn: number; prompt: string }
  | { type: "status_change"; status: "active" | "paused" | "completed" | "failed"; reason: string };
```

Implementation via async generator:

```typescript
// packages/sdk/src/agent.ts
export class Agent {
  async *runUntil(
    goal: string,
    options?: GoalOptions,
  ): AsyncIterable<GoalEvent> {
    const maxTurns = options?.maxTurns ?? 20;
    let turn = 0;
    const goalState: GoalState = { goal, status: "active", turnsUsed: 0 };

    yield { type: "status_change", status: "active", reason: "Goal started" };
    
    while (turn < maxTurns && goalState.status === "active") {
      turn += 1;
      yield { type: "turn_start", turn, goal };
      
      // 1. Run a turn
      const continuationPrompt = turn === 1
        ? goal // initial
        : "Continue working toward the goal.";
      
      const run = await this.send(continuationPrompt);
      const result = await run.wait();
      yield {
        type: "agent_response",
        turn,
        content: result.result ?? "",
      };
      
      // 2. Judge verdict
      const verdict = await this.#judgeGoal(goal, result.result);
      yield {
        type: "judge_verdict",
        turn,
        verdict: verdict.kind,
        reason: verdict.reason,
      };
      
      if (verdict.kind === "done") {
        goalState.status = "completed";
        yield { type: "status_change", status: "completed", reason: verdict.reason };
        return;
      }
      
      // 3. Compose continuation
      const continuation = composeContinuation(goal, verdict, result.result);
      yield { type: "continuation", turn, prompt: continuation };
    }
    
    if (goalState.status === "active") {
      yield {
        type: "status_change",
        status: "failed",
        reason: `Max turns (${maxTurns}) exhausted`,
      };
    }
  }
  
  // Cancellation API
  pauseGoal(): void { /* updates internal flag */ }
  clearGoal(): void { /* aborts iteration */ }
}
```

## Consumption pattern

Consumer code é idiomatic JS:

```typescript
const agent = await Agent.create({ ... });

// Simple consumption — log every event
for await (const event of agent.runUntil("write the auth tests")) {
  console.log(event);
  if (event.type === "status_change" && event.status === "completed") {
    console.log("Done!");
  }
}

// Filtered consumption — only verdicts
for await (const event of agent.runUntil("...")) {
  if (event.type === "judge_verdict") {
    metrics.recordVerdict(event.verdict);
  }
}

// Early termination — break exits iteration cleanly
for await (const event of agent.runUntil("...")) {
  if (event.type === "agent_response" && event.content.includes("STOP")) {
    break; // cancellation propaga via generator cleanup
  }
}

// Parallel observation
const goalStream = agent.runUntil("...");
const events: GoalEvent[] = [];

const collect = async () => {
  for await (const event of goalStream) events.push(event);
};

const interrupt = async () => {
  await new Promise((r) => setTimeout(r, 5000));
  agent.pauseGoal(); // signals generator to wind down
};

await Promise.all([collect(), interrupt()]);
```

## Why AsyncIterable instead of EventEmitter

| Aspecto | EventEmitter | AsyncIterable |
|---|---|---|
| Idiomatic JS | Legacy | Modern |
| Type-safe events | Generic typing, manual cast | Discriminated union, exhaustive switch |
| Backpressure | Não suportado | Built-in (consumer drives pull) |
| Error propagation | `'error'` event + listeners | `try/catch` em consumer |
| Cancellation | Manual `removeAllListeners` | `break` ou generator return |
| Test ergonomics | Manual subscribe + assert | `expect(eventArray).toEqual(...)` direto |

EventEmitter funciona mas requer mais boilerplate. AsyncIterable é o
pattern moderno (used by `ai` SDK from Vercel, MCP SDK, etc.).

## Architectural decisions

### AD-1: Discriminated union, not generic event

```typescript
// Wrong: generic, requires runtime check
interface Event { type: string; data: unknown; }

// Right: discriminated, type-safe
type Event = 
  | { type: "a"; payload: A } 
  | { type: "b"; payload: B };

for await (const event of stream) {
  switch (event.type) {
    case "a": handleA(event.payload); break; // event narrowed to A
    case "b": handleB(event.payload); break;
  }
}
```

### AD-2: Generator cleanup on early return

JavaScript generators run `finally` block on early consumer exit:

```typescript
async function* myGenerator() {
  const resource = await acquire();
  try {
    yield value1;
    yield value2;
  } finally {
    await resource.release(); // sempre roda, mesmo em `break`
  }
}

// Consumer:
for await (const v of myGenerator()) {
  if (v === stop) break; // finally roda → resource released
}
```

Esse pattern é como você implementa cancellation gracefully.

### AD-3: AbortSignal integration

```typescript
async *runUntil(goal: string, options?: { signal?: AbortSignal }) {
  options?.signal?.addEventListener("abort", () => {
    // Trigger cleanup via flag check inside loop
  });
  
  try {
    while (active) {
      if (options?.signal?.aborted) {
        yield { type: "status_change", status: "paused", reason: "aborted" };
        return;
      }
      // ... yield events ...
    }
  } finally {
    // cleanup
  }
}

// Consumer:
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);

for await (const event of agent.runUntil("...", { signal: controller.signal })) {
  // ...
}
```

### AD-4: Both yield and return final result (optional)

Sometimes consumer wants events + final result em uma chamada:

```typescript
async *runUntil(goal: string): AsyncGenerator<GoalEvent, GoalResult> {
  // ... yields events ...
  return { status: "completed", turnsUsed: 5, finalResponse: "..." };
}

// Consumer:
const gen = agent.runUntil("...");
let result: IteratorResult<GoalEvent, GoalResult>;
while (!(result = await gen.next()).done) {
  console.log(result.value); // GoalEvent
}
console.log(result.value); // GoalResult (return value)
```

`AsyncGenerator<TYield, TReturn>` é typed para esse caso.

## Failure modes prevenidos

1. **Memory leak via EventEmitter listeners**: forgot to
   `removeAllListeners`, listener cresce indefinidamente.
   Pattern: AsyncIterable não tem listeners — pull-based.

2. **Lost events**: EventEmitter emit antes do listener subscribe.
   Pattern: AsyncIterable replay-friendly — events queued no buffer
   interno do generator.

3. **Error swallowed silently**: EventEmitter sem 'error' handler joga
   exception não-catched, mata processo.
   Pattern: AsyncIterable throw propaga via `try/catch` consumer.

4. **No cancellation**: dev quer parar stream mid-way, EventEmitter precisa
   manual cleanup boilerplate.
   Pattern: `break` no `for-await-of` cleans up via finally.

## Failure modes NÃO prevenidos

- **Slow consumer**: consumer demora pra processar, producer espera
  (backpressure). Se producer é "real time" (websocket), events podem
  estar stale.
  Defesa: documenta latency; consumer pode bufferizar manualmente.

- **Generator runs once**: AsyncIterables não são replay-able. Each
  call para `agent.runUntil("...")` cria new iteration.
  Workaround: collect events em array, replay manually.

## Como testar

```typescript
it("yields events in order", async () => {
  const events: GoalEvent[] = [];
  for await (const e of agent.runUntil("test goal")) {
    events.push(e);
  }
  
  expect(events[0]).toMatchObject({ type: "status_change", status: "active" });
  expect(events.at(-1)).toMatchObject({ type: "status_change" });
});

it("emits turn_start + agent_response + judge_verdict per turn", async () => {
  const events: GoalEvent[] = [];
  for await (const e of agent.runUntil("test")) {
    if (events.length >= 5) break;
    events.push(e);
  }
  
  expect(events.map((e) => e.type)).toContain("turn_start");
  expect(events.map((e) => e.type)).toContain("agent_response");
  expect(events.map((e) => e.type)).toContain("judge_verdict");
});

it("supports cancellation via break", async () => {
  let cleanupRan = false;
  // Generator cleanup: assume internal finally sets flag
  
  for await (const event of agent.runUntil("...")) {
    if (event.type === "turn_start") break;
  }
  
  // After loop exit, generator's finally ran
  expect(cleanupRan).toBe(true);
});

it("propagates errors to consumer try/catch", async () => {
  vi.spyOn(agent, "send").mockRejectedValueOnce(new Error("LLM down"));
  
  await expect(async () => {
    for await (const e of agent.runUntil("test")) {
      // Should throw
    }
  }).rejects.toThrow("LLM down");
});
```

## Onde wirar no SDK

`packages/sdk/src/`:

- `types/goal-events.ts` — `GoalEvent` discriminated union
- `agent.ts` — `Agent.runUntil(goal)` returning `AsyncIterable<GoalEvent>`
- `agent.ts` — `Agent.pauseGoal()`, `Agent.clearGoal()` control API

Similar pattern existing in `stream-object.ts` (D39) — `StreamObjectEvent`.

## Referências cruzadas

- [prompt-cache-discipline.md](./prompt-cache-discipline.md) — continuation é user message, não system change
- [judge-call-pattern.md](./judge-call-pattern.md) — judge yields verdicts
- [forked-agent-pattern.md](./forked-agent-pattern.md) — fork pode também ser AsyncIterable

## Citações primárias

- `referencia/hermes-agent/hermes_cli/goals.py:580` — `evaluate_after_turn` Python
- `.claude/knowledge-base/hermes-deep-dive/02-runUntil-goal.md:1-100` — pattern
- ADR D39 (existente) — `Agent.streamObject` AsyncIterator
- ADR D60 (proposto) — `Agent.runUntil` AsyncIterable
