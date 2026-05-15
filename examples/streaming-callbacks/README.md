# Streaming callbacks (onStep + onDelta)

Per-send callbacks for fine-grained progress. `onDelta` fires for every
`InteractionUpdate` (token deltas, partial tool-call args, thinking
chunks). `onStep` fires once per completed `ConversationStep`.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## ⚠️ Implementation status

The public API accepts `onStep` and `onDelta` (declared on `SendOptions`
in `docs.md`). The **fixture-mode runtime** invokes them and the
contract is exercised by tests. The **real LLM runtime** (Anthropic /
OpenAI / OpenRouter agent loop) does NOT yet route stream events into
these callbacks, so against a live provider you'll observe:

```
Total steps: 0, total deltas: 0
Final result: <text>
```

Final result arrives correctly. Tracking: wire `real-local-run.ts`
event stream into the SendOptions callbacks. Use `run.stream()`
instead today for token-level streaming against real providers.

## Use cases (once wired)

- Building progress bars / spinners
- Streaming text to a UI as tokens arrive
- Real-time observability (token counts, step timings)
- Cancellation logic that watches for specific delta types

The callbacks are awaited — return a promise to apply backpressure.
