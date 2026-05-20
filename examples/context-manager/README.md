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

## Behaviour

The loaded sources are auto-injected into the LLM system prompt as a
`<context>...</context>` block (ADR D3). When the total token count
exceeds `maxTokens`, each source is truncated proportionally — a
per-source floor protects against starvation when many sources share
a tiny budget. Source bodies are XML-escaped before embedding so a
file containing literal `</context>` cannot break out of the block
(ADR D9 — prompt-injection defence).

The model answers the question against the loaded facts. Source
ordering preserves `.theokit/context.json` declaration order.

