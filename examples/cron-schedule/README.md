# Cron scheduling

Schedules agent runs on a cron expression using the public `Cron`
namespace. Backed by [croner](https://github.com/Hexagon/croner) — the
scheduler installs a real timer per enabled local job, computes the
next fire time from the cron expression + timezone, and supports
manual off-schedule firing via `Cron.run(jobId)`.

Cron is the one SDK feature that does **not** require a provider key —
the scheduler itself is a pure-Node component. You only need a provider
key if you wire fire handling to run an actual agent.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. `Cron.start()` activates the in-process scheduler.
2. `Cron.create()` registers a job with cron `*/5 * * * *` (every 5
   minutes, UTC). The scheduler computes `nextRunAt` immediately.
3. `Cron.list()` returns the job.
4. `Cron.run(jobId)` fires it manually — useful for testing or
   bookkeeping outside the schedule.
5. `Cron.disable(jobId)` suspends the timer but keeps the job.
6. `Cron.enable(jobId)` re-installs the timer and recomputes `nextRunAt`.
7. `Cron.stop()` + `Cron.delete(jobId)` clean everything up.

## Expected output

```
Scheduler started.
Job cron-<id> scheduled — next run at 2026-05-15T15:20:00.000Z
Active jobs: cron-<id>
Triggering a manual fire (off-schedule)…
Manual fire dispatched as run run-<id>.
Disabling the job…
Status: paused
Re-enabling…
Status: scheduled, nextRunAt: 2026-05-15T15:25:00.000Z
Stopping scheduler and deleting job…
Done.
```

## Supported cron syntax

The validator accepts the standard 5-field POSIX cron syntax:

```
minute hour day-of-month month day-of-week
```

Plus the shorthands `@hourly`, `@daily`, `@weekly`, `@monthly`,
`@yearly`. Star (`*`), star-step (`*/N`), ranges (`N-M`), and lists
(`N,M,P`) all work. Timezones use IANA names (e.g. `America/Sao_Paulo`,
`UTC`).
