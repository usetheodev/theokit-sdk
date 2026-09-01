/**
 * Owner: `internal/cron/` (4 of 5 importers). Derived from the import graph, not declared —
 * `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 */
import type { Workflow } from "../workflow.js";
import type { AgentOptions } from "./agent.js";
import type { SDKUserMessage } from "./run.js";

/**
 * Runtime hosting a cron job. Mirrors the agent runtime split.
 *
 * - `local` — the in-process scheduler activated via `Cron.start()` fires the
 *   job while the host process is alive.
 * - `cloud` — Theo PaaS schedules the job server-side; fires independent of
 *   any SDK process.
 *
 * @public
 */
export type CronRuntime = "local" | "cloud";

/**
 * Lifecycle state reported by `Cron.list()` / `Cron.get()`.
 *
 * @public
 */
export type CronJobStatus = "scheduled" | "running" | "paused" | "errored";

/**
 * Persistent cron-scheduled invocation of the Theo agent or a workflow.
 *
 * Exactly one target is set: {@link CronJob.agent} (ephemeral agent created on
 * each fire), {@link CronJob.agentId} (bound to an existing agent for context
 * continuity), or {@link CronJob.workflow} (a committed workflow run per fire;
 * SE35). Agent targets carry a `message`; a workflow target carries `inputData`.
 *
 * @public
 */
export interface CronJob {
  id: string;
  name?: string;
  /** Standard 5-field POSIX cron expression or shorthand (`@hourly`, `@daily`, ...). */
  cron: string;
  /** IANA timezone identifier. Defaults to `"UTC"`. */
  timezone?: string;
  /** Message sent to the agent on each fire. Present for agent targets; absent for a workflow target. */
  message?: string | SDKUserMessage;
  /** Ephemeral agent options. Mutually exclusive with `agentId`/`workflow`. */
  agent?: AgentOptions;
  /** ID of an existing agent to reuse for context continuity. Mutually exclusive with `agent`/`workflow`. */
  agentId?: string;
  /**
   * SE35 — a committed {@link Workflow} run on each fire (`workflow.run(inputData)`).
   * Mutually exclusive with `agent`/`agentId`. Held in-memory (local runtime only —
   * a workflow instance cannot cross the cloud process boundary). ADR 0014.
   */
  workflow?: Workflow;
  /** SE35 — input passed to `workflow.run(inputData)` on each fire. Workflow targets only. */
  inputData?: unknown;
  /** Whether the scheduler will fire this job on schedule. */
  enabled: boolean;
  /** Current status. */
  status: CronJobStatus;
  /** Runtime that hosts this job. Inferred from `agent`/`agentId`/`workflow` at create time (a `workflow` target is always `local`). */
  runtime: CronRuntime;
  /** Unix ms of the last successful fire, if any. */
  lastRunAt?: number;
  /** Unix ms of the next scheduled fire, computed by the scheduler. */
  nextRunAt?: number;
  /** Unix ms when the job was created. */
  createdAt: number;
}

/**
 * Options for `Cron.create()`.
 *
 * Pass exactly ONE target: `agent` (ephemeral agent fresh per fire), `agentId`
 * (reuse an existing agent — preserves conversation context), or `workflow`
 * (SE35 — run a committed workflow per fire). Agent targets REQUIRE `message`;
 * a workflow target takes `inputData` and MUST NOT set `message`. Violations are
 * a `ConfigurationError`.
 *
 * @public
 */
export interface CronCreateOptions {
  cron: string;
  /** Message for an agent target. Required with `agent`/`agentId`; forbidden with `workflow`. */
  message?: string | SDKUserMessage;
  agent?: AgentOptions;
  agentId?: string;
  /** SE35 — a committed {@link Workflow} to run per fire. Mutually exclusive with `agent`/`agentId`. */
  workflow?: Workflow;
  /** SE35 — input for `workflow.run(inputData)`. Workflow targets only. */
  inputData?: unknown;
  name?: string;
  timezone?: string;
  /** Defaults to `true`. */
  enabled?: boolean;
  /** Falls back to `THEOKIT_API_KEY`. */
  apiKey?: string;
}

/**
 * Options for `Cron.list()`.
 *
 * @public
 */
export type CronListOptions = {
  limit?: number;
  cursor?: string;
} & (
  | { runtime?: undefined }
  | { runtime: "local"; cwd?: string }
  | { runtime: "cloud"; apiKey?: string }
);

/**
 * Options for `Cron.get()`.
 *
 * @public
 */
export interface CronGetOptions {
  cwd?: string;
  apiKey?: string;
}

/**
 * Options for `Cron.delete()` / `Cron.enable()` / `Cron.disable()`.
 *
 * @public
 */
export interface CronOperationOptions {
  cwd?: string;
  apiKey?: string;
}

/**
 * Options for `Cron.run()` — manually trigger a job off-schedule.
 *
 * @public
 */
export interface CronRunOptions {
  cwd?: string;
  apiKey?: string;
}

/**
 * Options for `Cron.start()` — activates the in-process scheduler for local
 * jobs.
 *
 * @public
 */
export interface CronStartOptions {
  /** Local workspace whose `.theokit/cron/jobs.json` to load. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override the env API key. */
  apiKey?: string;
}

/**
 * Snapshot of the local scheduler returned by `Cron.status()`.
 *
 * @public
 */
export interface CronSchedulerStatus {
  /** Whether the in-process scheduler is currently running. */
  running: boolean;
  /** Number of jobs loaded into the scheduler. */
  jobCount: number;
  /** Unix ms of the next scheduled fire across all jobs, if any. */
  nextFireAt?: number;
  /** Last error observed in the scheduler, if any. */
  lastError?: { jobId: string; message: string; at: number };
}
