# {{projectName}}

A router and two specialists, scaffolded by `theokit init`.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm dev "Translate to French: good morning"
```

## What this does

1. `AgentFactory.create({ … })` captures the configuration all three agents
   share — key, model, workspace.
2. A classifier reads the input and names the specialist.
3. `factory.forSession(id, { systemPrompt })` builds that specialist; only the
   prompt differs.

Writing `Agent.create` three times would work, and would drift the shared half
apart on the first edit. The factory is what keeps one prefix in one place.

## Requirements

- Node 22.12+.
- One of: Anthropic / OpenAI / OpenRouter API key.

## Next steps

- Swap `forSession` for `getOrCreate` when a specialist should remember earlier
  turns.
- Add a specialist by adding one entry to `SPECIALISTS` — nothing else changes.
