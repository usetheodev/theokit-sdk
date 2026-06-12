---
user-invocable: false
paths:
  - "**/*cron*"
  - "**/*Cron*"
  - "**/*job*"
  - "**/*schedule*"
description: TheoKit SDK Cron jobs API reference — Cron.create, schedule syntax, job lifecycle
---

# TheoKit Cron Jobs

Schedule Theo agent runs on a cron expression. Two runtimes mirror the agent
split: local (in-process scheduler) and cloud (Theo PaaS, pre-release).

## Creating a job

```typescript
import { Cron } from "@theokit/sdk";

const job = await Cron.create({
  cron: "0 9 * * *",                 // every day at 09:00
  timezone: "America/Sao_Paulo",
  message: "Summarize yesterday's commits and post to #engineering",
  agent: {
    apiKey: process.env.THEOKIT_API_KEY!,
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: process.cwd() },
  },
});

await Cron.start();  // required for local jobs to fire
```

## Agent binding

Pass exactly one of:

- **`agent`** (full `AgentOptions`) — a fresh agent is created on every fire.
  Use for independent runs.
- **`agentId`** (string) — reuses an existing agent's conversation context
  across fires. Use for continuity (e.g., weekly review building on past notes).

Setting both raises `ConfigurationError`.

## Cron expressions

| Format | Example | Meaning |
|---|---|---|
| 5-field POSIX | `0 9 * * *` | Minute, hour, day-of-month, month, day-of-week |
| `@hourly` | `@hourly` | Every hour at minute 0 |
| `@daily` | `@daily` | Every day at midnight |
| `@weekly` | `@weekly` | Every Sunday at midnight |
| `@monthly` | `@monthly` | First day of month at midnight |
| `@yearly` | `@yearly` | January 1 at midnight |

`timezone` accepts any IANA identifier (default: `"UTC"`). Invalid expressions
throw `ConfigurationError` synchronously at create time.

## Managing jobs

```typescript
const { items } = await Cron.list({ runtime: "local", cwd: process.cwd() });
const job = await Cron.get(jobId);

await Cron.disable(jobId);   // pause without deleting
await Cron.enable(jobId);    // resume
await Cron.delete(jobId);    // permanent removal
```

## Manual fire (off-schedule)

```typescript
const run = await Cron.run(jobId);

for await (const event of run.stream()) {
  // same SDKMessage events as any other run
}
```

Manual fires do not update `lastRunAt` — only scheduled fires do.

## Local scheduler lifecycle

```typescript
await Cron.start({ cwd: process.cwd() });  // reads .theokit/cron/jobs.json
const status = await Cron.status();
// { running: true, jobCount: 3, nextFireAt: 1747... }
await Cron.stop();  // halts scheduling; does NOT delete jobs
```

Local jobs only fire while the host process is alive. Run as `pm2` / `systemd`
service for 24/7 local scheduling.

## Persistence

Local cron state lives in `.theokit/cron/jobs.json`. Created automatically by
`Cron.create()`. Commit it if jobs should travel with the repo; add to
`.gitignore` if environment-specific.

## Type reference

```typescript
interface CronJob {
  id: string;
  name?: string;
  cron: string;
  timezone?: string;
  message: string | SDKUserMessage;
  agent?: AgentOptions;              // mutually exclusive with agentId
  agentId?: string;
  enabled: boolean;
  status: "scheduled" | "running" | "paused" | "errored";
  runtime: "local" | "cloud";
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
}

interface CronCreateOptions {
  cron: string;
  message: string | SDKUserMessage;
  agent?: AgentOptions;
  agentId?: string;
  name?: string;
  timezone?: string;
  enabled?: boolean;                 // defaults to true
  apiKey?: string;
}

interface CronSchedulerStatus {
  running: boolean;
  jobCount: number;
  nextFireAt?: number;
  lastError?: { jobId: string; message: string; at: number };
}
```

## Cloud jobs (pre-release)

Cloud jobs use Theo PaaS and do not need `Cron.start()`. Pass `agent.cloud`
to create a cloud-scheduled job. Pre-release — not yet GA.

## Known limitations

- Local jobs only fire while the host process is alive.
- In-flight fires are not resumed if the host process crashes mid-run.
- `Cron.run()` (manual fire) does not update `lastRunAt`.
