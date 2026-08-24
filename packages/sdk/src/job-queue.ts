/**
 * `JobQueue` — background job queue with status tracking, cancellation, and an
 * optional concurrency bound.
 *
 * EC-1: all enqueued functions are wrapped in Promise.resolve().then() so
 * synchronous throws become rejections.
 *
 * #58: each job runs under an `AbortController` whose signal is passed to the
 * job fn, so `cancel()` actually interrupts a running job (not just a status
 * flip); an optional `maxConcurrency` bounds how many jobs run at once.
 */

import { randomUUID } from "node:crypto";

type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface Job<T> {
  id: string;
  status: JobStatus;
  result?: T;
  error?: string;
}

/** #58 — construction options. */
export interface JobQueueOptions {
  /**
   * Max jobs running concurrently. Omit for unbounded (previous behavior).
   * Values < 1 are clamped to 1 (an invalid bound must not deadlock).
   */
  maxConcurrency?: number;
}

/**
 * An in-process queue of background jobs with status tracking, cancellation, and an optional
 * concurrency bound.
 *
 * `enqueue` returns a job id immediately and never throws for the job's own failure: a synchronous
 * throw inside the function becomes a rejection, and a rejection becomes `status: "failed"` with
 * the message on `job.error`. Poll `getJob(id)` or `list()` for outcomes — there is no completion
 * event and no promise to await.
 *
 * Cancellation is COOPERATIVE. `cancel` aborts the `AbortSignal` handed to the job function and
 * flips the status, but a function that ignores the signal keeps running to completion; its result
 * is then discarded, because a cancelled job never leaves the cancelled state. The concurrency slot
 * of a running job is freed at cancel time rather than when it eventually settles, so a job that
 * never settles cannot deadlock a bounded queue.
 *
 * State lives entirely in memory and grows without bound — nothing evicts finished jobs. This is a
 * queue for one process, not a durable one.
 */
export class JobQueue {
  private jobs = new Map<string, Job<unknown>>();
  private controllers = new Map<string, AbortController>();
  private readonly maxConcurrency: number;
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(options: JobQueueOptions = {}) {
    this.maxConcurrency =
      options.maxConcurrency === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(1, options.maxConcurrency);
  }

  /**
   * Enqueue a background function. Returns the job ID immediately. The function
   * receives an `AbortSignal` that fires when the job is cancelled (#58) — a
   * cooperative job should observe it to stop early. Existing `() => Promise<T>`
   * callers are unaffected (the signal argument is simply ignored).
   */
  enqueue<T>(fn: (signal: AbortSignal) => Promise<T>): string {
    const id = randomUUID();
    const job: Job<T> = { id, status: "pending" };
    this.jobs.set(id, job as Job<unknown>);
    const controller = new AbortController();
    this.controllers.set(id, controller);

    void this.#acquire().then(() => {
      // Cancelled while waiting for a slot → never start.
      if (job.status === "cancelled") {
        this.#release(id);
        return;
      }
      job.status = "running";
      Promise.resolve()
        .then(() => fn(controller.signal))
        .then((result) => {
          if (job.status === "cancelled") return;
          job.result = result;
          job.status = "completed";
        })
        .catch((err: unknown) => {
          if (job.status === "cancelled") return;
          job.error = err instanceof Error ? err.message : String(err);
          job.status = "failed";
        })
        .finally(() => this.#release(id));
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
   * Cancel a pending or running job. Returns true if cancelled. #58 — aborts the
   * job's `AbortSignal` so a cooperative running job is actually interrupted.
   */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === "pending" || job.status === "running") {
      const wasRunning = job.status === "running";
      job.status = "cancelled";
      this.controllers.get(id)?.abort();
      // A running job holds a concurrency slot; its fn may ignore the signal and
      // never settle, so free the slot NOW rather than waiting for `.finally`
      // (which would never fire → the bounded queue would deadlock). `#release`
      // is idempotent, so the job's eventual `.finally` is a no-op. A *pending*
      // job holds no slot yet — its slot-grant self-releases when it starts.
      if (wasRunning) this.#release(id);
      return true;
    }
    return false;
  }

  /** Acquire a concurrency slot (resolves immediately when unbounded/free). */
  #acquire(): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.running += 1;
        resolve();
      });
    });
  }

  /**
   * Release a slot + clean up the controller; start the next waiting job.
   * Idempotent — keyed on the controller's presence, so a running job that was
   * cancelled (released early) does not double-decrement when its `.finally`
   * eventually fires.
   */
  #release(id: string): void {
    if (!this.controllers.has(id)) return; // already released
    this.controllers.delete(id);
    this.running -= 1;
    const next = this.waiting.shift();
    if (next !== undefined) next();
  }
}
