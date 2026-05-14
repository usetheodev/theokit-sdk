import { ConfigurationError } from "./errors.js";
import type { ListResult } from "./types/agent.js";
import type {
  CronCreateOptions,
  CronGetOptions,
  CronJob,
  CronListOptions,
  CronOperationOptions,
  CronRunOptions,
  CronSchedulerStatus,
  CronStartOptions,
} from "./types/cron.js";
import type { Run } from "./types/run.js";

const NOT_IMPLEMENTED = "Not implemented yet — see CHANGELOG.md and docs.md";

/**
 * Static façade for scheduling Theo agent runs on a cron expression.
 *
 * Two runtimes, picked from how the job is created:
 *
 * - **Local** — pass `agent.local` or `agentId` with `agent-` prefix.
 *   The in-process scheduler (activate with `Cron.start()`) fires the job
 *   while the host process is alive. Persisted to `.theokit/cron/jobs.json`.
 * - **Cloud** — pass `agent.cloud` or `agentId` with `bc-` prefix.
 *   Theo PaaS schedules server-side; fires regardless of any SDK process.
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
  static create(_options: CronCreateOptions): Promise<CronJob> {
    return Promise.reject(new ConfigurationError(`Cron.create: ${NOT_IMPLEMENTED}`));
  }

  /**
   * List cron jobs (local, cloud, or both).
   *
   * @public
   */
  static list(_options?: CronListOptions): Promise<ListResult<CronJob>> {
    return Promise.reject(new ConfigurationError(`Cron.list: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Get a single cron job by ID.
   *
   * @public
   */
  static get(_id: string, _options?: CronGetOptions): Promise<CronJob> {
    return Promise.reject(new ConfigurationError(`Cron.get: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Delete a cron job permanently.
   *
   * @public
   */
  static delete(_id: string, _options?: CronOperationOptions): Promise<void> {
    return Promise.reject(new ConfigurationError(`Cron.delete: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Re-enable a paused cron job.
   *
   * @public
   */
  static enable(_id: string, _options?: CronOperationOptions): Promise<CronJob> {
    return Promise.reject(new ConfigurationError(`Cron.enable: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Pause a cron job without deleting it. Resume with `Cron.enable()`.
   *
   * @public
   */
  static disable(_id: string, _options?: CronOperationOptions): Promise<CronJob> {
    return Promise.reject(new ConfigurationError(`Cron.disable: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Manually trigger a cron job off-schedule. Returns the resulting `Run`.
   *
   * @public
   */
  static run(_id: string, _options?: CronRunOptions): Promise<Run> {
    return Promise.reject(new ConfigurationError(`Cron.run: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Activate the in-process scheduler for local cron jobs.
   *
   * No-op for cloud-only deployments — cloud jobs are scheduled by Theo PaaS.
   * Pair with `Cron.stop()` for graceful shutdown.
   *
   * @public
   */
  static start(_options?: CronStartOptions): Promise<void> {
    return Promise.reject(new ConfigurationError(`Cron.start: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Stop the in-process scheduler. Existing jobs are NOT deleted — call
   * `Cron.start()` again to resume firing.
   *
   * @public
   */
  static stop(): Promise<void> {
    return Promise.reject(new ConfigurationError(`Cron.stop: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Snapshot of the local scheduler. Returns runtime-specific metadata.
   *
   * @public
   */
  static status(_options?: CronStartOptions): Promise<CronSchedulerStatus> {
    return Promise.reject(new ConfigurationError(`Cron.status: ${NOT_IMPLEMENTED}`));
  }
}
