# cloud-with-subagents

Demonstrates that `AgentOptions.agents` (inline subagent definitions) serializes
cleanly into the cloud-agent payload. Subagents are pure declarative config —
no closures, no local state — so they survive the trip to PaaS unchanged.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Creates a cloud agent with two inline subagents (`reviewer`, `tester`).
2. Prints `agent.cloudPayload.agents` showing each subagent reconstructed in
   the canonical payload PaaS will reconstruct from.

## Why subagents work in cloud

Subagent fields are all string/value-typed:

- `description: string`
- `prompt: string`
- `model: { id: string }`

No functions, no file paths, no local state. They serialize round-trip
through JSON without any redaction or rejection. PaaS spawns them as
subagent processes inside its VM exactly as `LocalAgent` does in-process.
