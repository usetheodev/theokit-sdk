/**
 * `JobQueue` — background job queue with status tracking.
 *
 * EC-1: all enqueued functions are wrapped in Promise.resolve().then()
 * to ensure synchronous throws become rejections.
 */

import { randomUUID } from "node:crypto";

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Job<T> {
  id: string;
  status: JobStatus;
  result?: T;
  error?: string;
}

export class JobQueue {
  private jobs = new Map<string, Job<unknown>>();

  /**
   * Enqueue a background function. Returns the job ID immediately.
   * EC-1: wraps fn in Promise.resolve().then() so sync throws are caught.
   */
  enqueue<T>(fn: () => Promise<T>): string {
    const id = randomUUID();
    const job: Job<T> = { id, status: "pending" };
    this.jobs.set(id, job as Job<unknown>);

    job.status = "running";
    Promise.resolve()
      .then(() => fn())
      .then((result) => {
        if (job.status === "cancelled") return;
        job.result = result;
        job.status = "completed";
      })
      .catch((err: unknown) => {
        if (job.status === "cancelled") return;
        job.error = err instanceof Error ? err.message : String(err);
        job.status = "failed";
      });

    return id;
  }

  getJob(id: string): Job<unknown> | undefined {
    return this.jobs.get(id);
  }

  list(): Job<unknown>[] {
    return [...this.jobs.values()];
  }

  /**
   * Cancel a pending or running job. Returns true if cancelled.
   */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === "pending" || job.status === "running") {
      job.status = "cancelled";
      return true;
    }
    return false;
  }
}
