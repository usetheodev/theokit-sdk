# Cron jobs

Schedule Theo agent runs on a cron expression. Two runtimes mirror the agent split:

| Runtime | What runs the job |
| --- | --- |
| **Local** | The in-process scheduler activated via `Cron.start()`. Jobs fire while the host process is alive. Persisted to `.theokit/cron/jobs.json`. |
| **Cloud** | Theo PaaS schedules the job server-side. Fires regardless of any SDK process. *Pre-release.* |

The runtime is inferred from how the job is created: pass `agent.local` or an `agentId` with `agent-` prefix for local; pass `agent.cloud` or an `agentId` with `bc-` prefix for cloud.

---

## Creating a job

```typescript
import { Cron } from "@usetheo/sdk";

const job = await Cron.create({
  cron: "0 9 * * *",                 // every day at 09:00
  timezone: "America/Sao_Paulo",
  message: "Summarize yesterday's commits and post to #engineering",
  agent: {
    apiKey: process.env.THEOKIT_API_KEY!,
    model: { id: "google/gemini-2.0-flash-exp:free" },
    local: { cwd: process.cwd() },
  },
});

await Cron.start();                  // required for local jobs to actually fire
```

### Agent binding: ephemeral vs persistent

Pass exactly one of:

- **`agent`** — full `AgentOptions`. A fresh agent is created on every fire. Use when each run is independent.
- **`agentId`** — string ID of an existing agent. The job reuses that agent's conversation context across fires. Use when you want continuity (e.g., a weekly review that builds on past notes).

Setting both raises a `ConfigurationError`.

### Supported cron expressions

| Format | Example | Meaning |
| --- | --- | --- |
| 5-field POSIX | `0 9 * * *` | Minute, hour, day-of-month, month, day-of-week |
| `@hourly` | `@hourly` | Every hour, at minute 0 |
| `@daily` | `@daily` | Every day at midnight |
| `@weekly` | `@weekly` | Every Sunday at midnight |
| `@monthly` | `@monthly` | First day of each month at midnight |
| `@yearly` | `@yearly` | January 1 at midnight |

`timezone` accepts any IANA identifier (e.g., `"UTC"`, `"America/Sao_Paulo"`, `"Asia/Tokyo"`). Defaults to `"UTC"`.

Invalid expressions throw `ConfigurationError` synchronously at create time — no surprise failures at first fire.

---

## Listing and managing jobs

```typescript
const { items } = await Cron.list({ runtime: "local", cwd: process.cwd() });

const job = await Cron.get(jobId);

await Cron.disable(jobId);   // pause without deleting
await Cron.enable(jobId);    // resume
await Cron.delete(jobId);    // permanent
```

## Manual fire (off-schedule)

```typescript
const run = await Cron.run(jobId);

for await (const event of run.stream()) {
  // same as any other run
}
```

Manual fires do not update `lastRunAt` — only scheduled fires do.

---

## The local scheduler

The in-process scheduler must be explicitly started for local jobs to fire.

```typescript
await Cron.start({ cwd: process.cwd() });

const status = await Cron.status();
// { running: true, jobCount: 3, nextFireAt: 1747... }

await Cron.stop();
```

### Lifecycle

1. `Cron.start()` reads `.theokit/cron/jobs.json` and schedules every enabled job.
2. Jobs fire as their cron expression matches the current time (in the job's timezone).
3. `Cron.stop()` halts scheduling but does NOT delete jobs — call `Cron.start()` again to resume.

### Persistence model

Local cron state lives in `.theokit/cron/jobs.json` under the workspace root. The file is created automatically by `Cron.create()`. Treat it like any other config artifact:

- Commit it to git if you want jobs to travel with the repo.
- Add it to `.gitignore` if jobs are environment-specific (recommended for jobs that carry secrets in their `agent` options).

Cloud jobs are stored server-side and require no local state.

---

## Cloud jobs (pre-release)

For 24/7 scheduling without a long-running SDK process, use the cloud runtime once Theo PaaS reaches GA.

```typescript
const job = await Cron.create({
  cron: "@daily",
  message: "Run the nightly health check",
  agent: {
    apiKey: process.env.THEOKIT_API_KEY!,
    model: { id: "google/gemini-2.0-flash-exp:free" },
    cloud: {
      repos: [{ url: "https://github.com/your-org/your-repo", startingRef: "main" }],
    },
  },
});

// No Cron.start() needed — PaaS fires it server-side
```

---

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

---

## Known limitations

- **Local jobs only fire while the host process is alive.** Run the SDK process as a `systemd` / `launchd` / `pm2` service for 24/7 local scheduling, or use the cloud runtime.
- **In-flight fires are not resumed** if the host process crashes mid-run. The job will fire again on its next scheduled tick.
- `Cron.run()` does not update `lastRunAt` — only scheduled fires do.

## Next

- [Error handling](./error-handling.md) — `ConfigurationError` causes for invalid cron specs
- [Resource management](./resource-management.md) — graceful shutdown alongside `Cron.stop()`
