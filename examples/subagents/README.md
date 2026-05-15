# Subagents

Inline subagent definitions via `AgentOptions.agents`. Each subagent
is a named entry with its own `description`, `prompt` (system context),
and optional model override. The parent agent sees them in its tool
list and can spawn one via the Agent tool.

Subagents do NOT inherit the parent's `systemPrompt` — they use their
own `AgentDefinition.prompt` exclusively.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## Two subagents are defined

- **reviewer** — security-focused code reviewer
- **tester** — test engineer suggesting test cases
