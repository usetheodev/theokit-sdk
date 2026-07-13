# example-prompts

Instructions are the system prompt — a plain string, a resolver evaluated per send, or a
per-send override.

Pairs with the docs page **[Prompts](https://docs.usetheo.dev/theokit/prompts)**.

## Run

```bash
pnpm install
export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys — or put it in .env
pnpm run run
```

## What it shows

- `systemPrompt: (ctx) => string` — dynamic instructions from `SystemPromptContext`
  (`userMessage`, `model`, `memory`, …).
- `agent.send(msg, { systemPrompt })` — a per-send string override that wins over the resolver.
