# example-tool-basics

Give an agent a typed tool with `defineTool` — the model calls it when the prompt
calls for it, and the Zod schema validates the arguments first.

Pairs with the docs page **[Tools › Give an agent a tool](https://docs.usetheo.dev/theokit/tools)**.

## Run

```bash
pnpm install
export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys — or put it in .env
pnpm run run
```

## What it shows

- `defineTool({ name, description, inputSchema, execute })` — the canonical tool factory.
- The Zod `inputSchema` is converted to JSON Schema and validated before `execute` runs.
- `tools: [getWeather]` on `Agent.create` — the agent decides when to call the tool.
