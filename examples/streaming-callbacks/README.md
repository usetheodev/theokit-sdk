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

## Behaviour

`onStep` fires once per completed assistant text turn AND once per tool
call inside a tool batch (using the `ConversationStep` discriminator
already public — `assistantMessage` and `toolCall`). `onDelta` fires
per `text-delta` token streamed from the provider.

Cancellation note: `onStep` only fires for **completed** steps. A run
cancelled mid-turn does not emit a synthetic "cancelled" step (EC-6) —
listen on `run.onDidChangeStatus` if you need cancellation events.

## Use cases

- Progress bars / spinners
- Streaming text to a UI as tokens arrive
- Real-time observability (token counts, step timings)
- Cancellation logic that watches for specific delta types

The callbacks are awaited — return a promise to apply backpressure.
Callback errors are caught and logged to stderr; they do NOT crash the
run.
