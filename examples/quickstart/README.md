# Quickstart

The smallest possible `@usetheo/sdk` program. Demonstrates the core
flow: **create → send → stream → wait**.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env       # paste one provider key
pnpm dev                   # options-bag form (Agent.create)
BUILDER=1 pnpm dev         # fluent-builder form (Agent.builder)
```

Both produce the same agent and the same output. Pick whichever
ergonomics fits your codebase.

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

## Two ways to create an agent

This example ships two equivalent entry points side by side. Pick the
one that matches your codebase style.

**Options-bag form** (`main()` — runs by default):

```ts
const agent = await Agent.create({
  apiKey: API_KEY,
  model: { id: pickModel() },
  local: { cwd: process.cwd() },
  systemPrompt: SYSTEM_PROMPT,
});
```

**Fluent-builder form** (`mainWithBuilder()` — runs with `BUILDER=1`):

```ts
const agent = await Agent.builder()
  .apiKey(API_KEY)
  .model({ id: pickModel() })
  .local({ cwd: process.cwd() })
  .systemPrompt(SYSTEM_PROMPT)
  .create();
```

Both produce the same `SDKAgent`. `Agent.builder()` is just syntactic
sugar over `Agent.create()` (ADR D25) — same validation, same
persistence, same surface. Use the builder when you want progressive
construction (e.g., applying setters conditionally before `.create()`).
See also `Agent.builder().getOrCreate(agentId)` for the resume-or-create
flow used by chat-bot patterns.
