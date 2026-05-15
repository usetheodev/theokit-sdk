# Context manager

File-based project context. The SDK reads `.theokit/context.json`,
loads the declared sources into memory, and exposes a redacted
snapshot via `agent.context.snapshot()`.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Writes `workspace/facts.md` with a few project facts.
2. Writes `workspace/.theokit/context.json` declaring `facts.md` as a
   context source with a 1000-token budget.
3. Creates an agent with `context: { manager: "file" }` and
   `settingSources: ["project"]` so the file gets loaded.
4. Prints the snapshot (source name, status, path, budget).
5. Asks the agent a question that requires the loaded context.

## ⚠️ Implementation status

The context manager loads, tokenises, and exposes the snapshot
correctly — `agent.context.snapshot()` returns the populated sources
list and budget. However, the loaded context is NOT yet injected into
the system prompt sent to the real LLM. Today the model answers
without seeing the file contents.

Tracking: extend `AgentLoopInputs.systemPrompt` builder to append a
context block (token-budgeted) for resolvers that opt in, OR have a
separate `contextPreamble` field that the agent loop concatenates
before user messages.

