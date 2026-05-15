import { ConfigurationError, UnknownAgentError } from "./errors.js";
import { getSchedulerState, startScheduler, stopScheduler } from "./internal/cron/scheduler.js";
import { deleteJob, getJob, jobCount, listJobs, upsertJob } from "./internal/cron/store.js";
import {
  estimateNextRunAt,
  validateCronExpression,
  validateTimezone,
} from "./internal/cron/validate.js";
import { resolveApiKey } from "./internal/env.js";
import { generateCronId } from "./internal/ids.js";
import { createStubRun } from "./internal/runtime/stub-run.js";
import type { AgentOptions, ListResult } from "./types/agent.js";
import type {
  CronCreateOptions,
  CronGetOptions,
  CronJob,
  CronListOptions,
  CronOperationOptions,
  CronRunOptions,
  CronRuntime,
  CronSchedulerStatus,
  CronStartOptions,
} from "./types/cron.js";
import type { Run } from "./types/run.js";

/**
 * Static façade for scheduling Theo agent runs on a cron expression.
 *
 * @public
 */
export class Cron {
  private constructor() {
    // Static-only façade.
  }

  /**
   * Create and persist a cron job.
   *
   * @public
   */
  static async create(options: CronCreateOptions): Promise<CronJob> {
    return createCronJob(options);
  }

  /**
   * List cron jobs (local, cloud, or both).
   *
   * @public
   */
  static list(options: CronListOptions = {}): Promise<ListResult<CronJob>> {
    const runtimeFilter = options.runtime;
    const items = listJobs().filter((job) =>
      runtimeFilter === undefined ? true : job.runtime === runtimeFilter,
    );
    return Promise.resolve({ items });
  }

  /**
   * Get a single cron job by ID.
   *
   * @public
   */
  static get(jobId: string, _options: CronGetOptions = {}): Promise<CronJob> {
    const job = getJob(jobId);
    if (job === undefined) {
      return Promise.reject(
        new UnknownAgentError(`Cron job ${jobId} not found`, { code: "unknown_cron_job" }),
      );
    }
    return Promise.resolve(job);
  }

  /**
   * Delete a cron job permanently.
   *
   * @public
   */
  static delete(jobId: string, _options: CronOperationOptions = {}): Promise<void> {
    deleteJob(jobId);
    return Promise.resolve();
  }

  /**
   * Re-enable a paused cron job.
   *
   * @public
   */
  static async enable(jobId: string, _options: CronOperationOptions = {}): Promise<CronJob> {
    return updateJobStatus(jobId, true);
  }

  /**
   * Pause a cron job without deleting it.
   *
   * @public
   */
  static async disable(jobId: string, _options: CronOperationOptions = {}): Promise<CronJob> {
    return updateJobStatus(jobId, false);
  }

  /**
   * Manually trigger a cron job off-schedule. Returns the resulting `Run`.
   *
   * @public
   */
  static async run(jobId: string, _options: CronRunOptions = {}): Promise<Run> {
    const job = getJob(jobId);
    if (job === undefined) {
      throw new UnknownAgentError(`Cron job ${jobId} not found`, { code: "unknown_cron_job" });
    }
    const agentId = resolveAgentIdFromJob(job);
    return createStubRun({ agentId, status: "running" });
  }

  /**
   * Activate the in-process scheduler for local cron jobs.
   *
   * @public
   */
  static start(options: CronStartOptions = {}): Promise<void> {
    startScheduler(options.cwd);
    return Promise.resolve();
  }

  /**
   * Stop the in-process scheduler. Jobs are preserved.
   *
   * @public
   */
  static stop(): Promise<void> {
    stopScheduler();
    return Promise.resolve();
  }

  /**
   * Snapshot of the local scheduler.
   *
   * @public
   */
  static status(_options: CronStartOptions = {}): Promise<CronSchedulerStatus> {
    const scheduler = getSchedulerState();
    return Promise.resolve({ running: scheduler.running, jobCount: jobCount() });
  }
}

async function createCronJob(options: CronCreateOptions): Promise<CronJob> {
  if (options.agent !== undefined && options.agentId !== undefined) {
    throw new ConfigurationError(
      "agent and agentId are mutually exclusive — pass either agent (ephemeral) or agentId (reuse).",
      { code: "cron_agent_exclusive" },
    );
  }
  if (options.agent === undefined && options.agentId === undefined) {
    throw new ConfigurationError("Cron job requires either agent or agentId", {
      code: "cron_missing_agent",
    });
  }

  validateCronExpression(options.cron);
  const timezone = options.timezone ?? "UTC";
  validateTimezone(timezone);

  // apiKey is accepted but not required for cron-create in fixture mode.
  resolveApiKey(options.apiKey);

  const runtime = detectRuntime(options);
  const now = Date.now();
  const job: CronJob = {
    id: generateCronId(),
    cron: options.cron,
    timezone,
    message: options.message,
    enabled: options.enabled ?? true,
    status: options.enabled === false ? "paused" : "scheduled",
    runtime,
    createdAt: now,
    nextRunAt: estimateNextRunAt(options.cron, timezone),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.agent !== undefined ? { agent: options.agent } : {}),
    ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
  };
  upsertJob(job);
  return job;
}

function detectRuntime(options: CronCreateOptions): CronRuntime {
  if (options.agentId !== undefined) {
    return options.agentId.startsWith("bc-") ? "cloud" : "local";
  }
  const agent = options.agent as AgentOptions | undefined;
  if (agent?.cloud !== undefined) return "cloud";
  return "local";
}

async function updateJobStatus(jobId: string, enabled: boolean): Promise<CronJob> {
  const existing = getJob(jobId);
  if (existing === undefined) {
    throw new UnknownAgentError(`Cron job ${jobId} not found`, { code: "unknown_cron_job" });
  }
  const updated: CronJob = {
    ...existing,
    enabled,
    status: enabled ? "scheduled" : "paused",
  };
  upsertJob(updated);
  return updated;
}

function resolveAgentIdFromJob(job: CronJob): string {
  if (job.agentId !== undefined) return job.agentId;
  return job.runtime === "cloud" ? "bc-pending" : "agent-pending";
}
