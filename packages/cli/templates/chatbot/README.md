# {{projectName}}

A conversational agent that remembers, scaffolded by `theokit init`.

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY
pnpm dev
```

## What this does

1. `Agent.getOrCreate(id, …)` — a stable id, so a second run resumes the same
   conversation instead of starting a fresh one.
2. Reads a line, streams the reply, loops.
3. Reports `result.status === "error"` with the provider's reason, so a run that
   ends without answering says why.

Persistence needs no configuration: every finished turn is appended to a session
transcript automatically. `SESSION_DIR` only chooses where it lands.

## Requirements

- Node 22.12+.
- One of: Anthropic / OpenAI / OpenRouter API key.

## Next steps

- `SESSION_DIR=~/.claude` writes sessions the Claude Code CLI can `--continue`.
- `AGENT_ID=support` runs a second, independent conversation from the same code.
- Add tools with `Tool.create({ name, description, inputSchema, handler })`.
