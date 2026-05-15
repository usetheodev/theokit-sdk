import { Cron as Croner } from "croner";

import type { CronJob } from "../../types/cron.js";
import { listJobs, upsertJob } from "./store.js";

/**
 * Real local cron scheduler. When `Cron.start()` is called the scheduler
 * installs a Croner timer per enabled local job; on fire the registered
 * fire handler runs the underlying agent. `Cron.stop()` tears every timer
 * down but keeps the jobs in the store.
 *
 * @internal
 */

export type CronFireHandler = (job: CronJob) => Promise<void> | void;

interface SchedulerState {
  running: boolean;
  cwd?: string;
  timers: Map<string, Croner>;
  fireHandler?: CronFireHandler;
}

const state: SchedulerState = { running: false, timers: new Map() };

/**
 * Register the callback invoked when a job fires. The runtime adapter
 * supplies a handler that actually executes the agent; fixture-mode tests
 * leave it unset so timers tick without side effects.
 *
 * @internal
 */
export function setCronFireHandler(handler: CronFireHandler | undefined): void {
  state.fireHandler = handler;
}

/** Activate the scheduler and install timers for every enabled local job. @internal */
export function startScheduler(cwd?: string): void {
  state.running = true;
  if (cwd !== undefined) state.cwd = cwd;
  for (const job of listJobs()) {
    if (job.runtime === "local" && job.enabled !== false) scheduleJob(job);
  }
}

/** Deactivate the scheduler. Stops every timer; jobs remain in the store. @internal */
export function stopScheduler(): void {
  state.running = false;
  for (const timer of state.timers.values()) timer.stop();
  state.timers.clear();
}

/** Schedule a single job. No-op if the scheduler is not running. @internal */
export function scheduleJob(job: CronJob): void {
  if (!state.running) return;
  unscheduleJob(job.id);
  const expression = normalizeExpression(job.cron);
  const timer = new Croner(
    expression,
    { timezone: job.timezone, name: job.id, protect: true },
    () => {
      void fireJob(job.id);
    },
  );
  state.timers.set(job.id, timer);
  refreshNextRunAt(job.id, timer);
}

/** Tear down the timer for a single job. @internal */
export function unscheduleJob(jobId: string): boolean {
  const timer = state.timers.get(jobId);
  if (timer === undefined) return false;
  timer.stop();
  state.timers.delete(jobId);
  return true;
}

/** Snapshot of the scheduler's running flag and configured workspace. @internal */
export function getSchedulerState(): { running: boolean; cwd?: string } {
  const result: { running: boolean; cwd?: string } = { running: state.running };
  if (state.cwd !== undefined) result.cwd = state.cwd;
  return result;
}

async function fireJob(jobId: string): Promise<void> {
  const fresh = listJobs().find((entry) => entry.id === jobId);
  if (fresh === undefined || fresh.enabled === false) return;
  const handler = state.fireHandler;
  upsertJob({ ...fresh, lastRunAt: Date.now() });
  if (handler === undefined) return;
  try {
    await handler(fresh);
  } catch {
    // Swallow handler errors — the scheduler must keep ticking. Real
    // surface for run failures lives on the Run.wait() result itself.
  }
}

function refreshNextRunAt(jobId: string, timer: Croner): void {
  const next = timer.nextRun();
  if (next === null) return;
  const existing = listJobs().find((entry) => entry.id === jobId);
  if (existing === undefined) return;
  upsertJob({ ...existing, nextRunAt: next.getTime() });
}

function normalizeExpression(cron: string): string {
  switch (cron) {
    case "@hourly":
      return "0 * * * *";
    case "@daily":
      return "0 0 * * *";
    case "@weekly":
      return "0 0 * * 0";
    case "@monthly":
      return "0 0 1 * *";
    case "@yearly":
      return "0 0 1 1 *";
    default:
      return cron;
  }
}
