# example-agent-basics

The smallest end-to-end path with `@theokit/sdk`: create a local agent against
your own provider key, send one message, await the result, dispose.

Pairs with the docs page **[Agents › Creating an agent](https://docs.usetheo.dev/theokit/agents)**.

## Run

```bash
pnpm install
export OPENROUTER_API_KEY=sk-or-...   # https://openrouter.ai/keys — or put it in .env
pnpm run run
```

## What it shows

- `Agent.create({ apiKey, model, name, systemPrompt })` — the canonical factory.
- `agent.send(message)` → `Run`; `await run.wait()` → `RunResult`.
- `result.result` (text), `result.status`, `result.model`, and typed `result.error`.
- `agent.dispose()` for resource cleanup.
