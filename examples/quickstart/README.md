# Quickstart

The smallest possible `@usetheo/sdk` program. Demonstrates the core
flow: **create → send → stream → wait**.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env       # paste one provider key
pnpm dev
```

## What it does

1. Calls `Agent.create()` with `local: { cwd: process.cwd() }`, a model
   id chosen from whichever provider key is set in `.env`, and a
   `systemPrompt` that steers the model toward a terse, persona-shaped
   response.
2. Sends one user message.
3. Iterates `run.stream()` — each `SDKMessage` event is yielded as soon
   as it arrives from the provider. Assistant text is printed.
4. Awaits `run.wait()` to get the final `RunResult` with status and
   duration.

## Expected output

```
Agent: agent-<uuid>

It's 2026, based on the most recent training data I have.

[status=finished duration=1840ms]
```

Visibly terse, no greetings, no emojis — the `systemPrompt` is doing
the work. Remove it (or pass `agent.send(..., { systemPrompt: "" })`)
to compare against the default-personality output.

## Configuring the system prompt

- **Per agent (default):** `Agent.create({ systemPrompt: "Be terse." })`.
- **Per call (override):** `agent.send("hi", { systemPrompt: "Be playful." })`.
- **Dynamic:** pass a resolver function to `AgentOptions.systemPrompt`
  that receives a `SystemPromptContext` with `agentId`, `cwd`, `model`,
  `skills`, and `userMessage` — useful for prompts that adapt to the
  workspace or active skills.
