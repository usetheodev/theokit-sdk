# {{projectName}}

A scheduled, multi-step pipeline, scaffolded by `theokit init`.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

## What this does

1. `Workflow.create(…).then(…).commit()` builds a three-step pipeline:
   `fn("collect")` → `agentStep("analyse")` → `fn("format")`.
2. Runs it once so you can see the output.
3. Hands the SAME committed workflow to `Cron.create({ cron, workflow })`.

The workflow is the unit of work; cron only decides when. `agentStep` runs the
agent and feeds it the previous step's output — there is no stream to drain by
hand, which is the difference between this and calling `agent.send` in a loop.

## Requirements

- Node 22.12+.
- One of: Anthropic / OpenAI / OpenRouter API key.

## Next steps

- `WORKFLOW_CRON="@hourly"` — five-field POSIX cron or a shorthand.
- Replace `fn("collect")` with a real fetch; the other two steps do not change.
- `.parallel(…)`, `.branch(…)`, `.foreach(…)` for fan-out and conditionals.
