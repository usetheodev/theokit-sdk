# Cron scheduling

Schedules agent runs on a cron expression — and actually **runs the
LLM** when the job fires. Backed by
[croner](https://github.com/Hexagon/croner) under the hood. The
scheduler installs a real timer per enabled local job and, on tick,
creates the configured agent and dispatches `job.message` through
`agent.send()`.

This example uses `Cron.run(jobId)` to force an off-schedule fire so
you don't have to wait for the next cron tick, but the same code path
runs when the timer ticks naturally.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env       # paste your provider key (Anthropic / OpenAI / OpenRouter)
pnpm dev
```

## What it does

1. `Cron.start()` activates the in-process scheduler and registers the
   default fire handler (`runCronJob`).
2. `Cron.create()` registers a job with cron `*/5 * * * *` (every 5
   minutes, UTC). The job carries:
   - `message` — the prompt the agent will receive on each fire.
   - `agent` — the full `AgentOptions` for the ephemeral agent that
     gets spawned every fire (model, cwd, etc.).
3. `Cron.run(jobId)` triggers an off-schedule fire. Internally this
   calls `Agent.create(job.agent)` then `agent.send(job.message)` and
   returns the real `Run`.
4. We iterate `run.stream()` and print assistant text as it arrives.
5. `await run.wait()` returns the final `RunResult` (status + duration).
6. Cleanup: `Cron.disable()`, `Cron.stop()`, `Cron.delete()`.

## Expected output

```
Scheduler started.
Job cron-<id> scheduled — next run at 2026-05-15T17:00:00.000Z

Triggering a manual fire (off-schedule)…
Run id: run-<id>
[assistant] Hello! Today is likely a weekday.

[run status=finished duration=1061ms]

Disabling, stopping, deleting…
Done.
```

The exact wording depends on the model. The contract that holds: the
fire produces a `Run` that ends in `status=finished` after a real
provider call.

## Supported cron syntax

5-field POSIX cron syntax:

```
minute hour day-of-month month day-of-week
```

Plus shorthands `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly`.
Star (`*`), star-step (`*/N`), ranges (`N-M`), and lists (`N,M,P`) all
work. Timezones use IANA names (e.g. `America/Sao_Paulo`, `UTC`).
