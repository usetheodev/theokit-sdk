import type { CronJob } from "../../types/cron.js";

/**
 * Process-wide cron job store. In Phase 1 we keep all jobs in memory
 * (across local + cloud runtimes). Local-runtime persistence to
 * `.theokit/cron/jobs.json` lands when the local runtime adapter is wired.
 *
 * @internal
 */
const jobs = new Map<string, CronJob>();

/** Snapshot of every known cron job. @internal */
export function listJobs(): CronJob[] {
  return Array.from(jobs.values());
}

/** Total job count across runtimes. @internal */
export function jobCount(): number {
  return jobs.size;
}

/** Fetch a single job by id, or `undefined` if it does not exist. @internal */
export function getJob(jobId: string): CronJob | undefined {
  return jobs.get(jobId);
}

/** Insert or replace a job. @internal */
export function upsertJob(job: CronJob): void {
  jobs.set(job.id, job);
}

/** Delete a job. Returns `true` if a job was removed. @internal */
export function deleteJob(jobId: string): boolean {
  return jobs.delete(jobId);
}

/** Test-only: drop every job. @internal */
export function clearJobs(): void {
  jobs.clear();
}
