# SendOptions per-call overrides

Demonstrates the three knobs you can override per `agent.send()` without
recreating the agent: `model`, `systemPrompt`, and (separately)
`mcpServers`. Model overrides are **sticky** — they update
`agent.model` for subsequent calls.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## Three runs, three behaviours

1. **Default** — agent's `systemPrompt` ("JSON-only API") wins. Output is a JSON object.
2. **Override `systemPrompt`** — per-call "poet" persona wins. Output is a rhyming couplet, no JSON.
3. **Override `model`** — switches to a different OpenRouter model id; agent.model updates afterwards.
