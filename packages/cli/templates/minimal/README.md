# {{projectName}}

A minimal `@theokit/sdk` agent scaffolded by `theokit init`.

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY
pnpm dev
```

## What this does

1. `Agent.create()` with provider auto-detection.
2. `agent.send()` streams the reply token-by-token.
3. Prints, exits.

## Requirements

- Node 22.12+.
- One of: Anthropic / OpenAI / OpenRouter API key (any).

## Next steps

- Add custom tools with `Tool.create({ name, description, inputSchema, handler })`.
- Switch to a local Ollama model by setting `AGENT_MODEL=ollama/llama3.2:3b`.
- Wire to a chat platform via `@theokit/gateway`.
