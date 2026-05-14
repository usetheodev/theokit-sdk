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
 * Persistent cron-scheduled invocation of the Theo agent.
 *
 * Exactly one of {@link CronJob.agent} (ephemeral agent created on each fire)
 * or {@link CronJob.agentId} (bound to an existing agent for context
 * continuity) is set.
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
  /** Message sent to the agent on each fire. */
  message: string | SDKUserMessage;
  /** Ephemeral agent options. Mutually exclusive with `agentId`. */
  agent?: AgentOptions;
  /** ID of an existing agent to reuse for context continuity. Mutually exclusive with `agent`. */
  agentId?: string;
  /** Whether the scheduler will fire this job on schedule. */
  enabled: boolean;
  /** Current status. */
  status: CronJobStatus;
  /** Runtime that hosts this job. Inferred from `agent`/`agentId` at create time. */
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
 * Pass `agent` for an ephemeral agent created fresh on each fire, OR
 * `agentId` to reuse an existing agent (preserves conversation context across
 * fires). Setting both is a `ConfigurationError`.
 *
 * @public
 */
export interface CronCreateOptions {
  cron: string;
  message: string | SDKUserMessage;
  agent?: AgentOptions;
  agentId?: string;
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
