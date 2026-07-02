import { describe, expect, it } from "vitest";
import { JobQueue } from "../src/job-queue.js";

const tick = () => new Promise((r) => setTimeout(r, 10));

/**
 * #58 — JobQueue.cancel only flipped a status flag (running work continued) and
 * there was no concurrency bound (every enqueue ran immediately).
 *
 * RED (pre-fix): the job fn receives no AbortSignal, so cancel cannot interrupt
 * it; maxConcurrency is unsupported so all jobs run at once.
 */
describe("JobQueue cancel-interrupts + concurrency bound (#58)", () => {
  it("cancel_aborts_a_running_job", async () => {
    const q = new JobQueue();
    let observedAbort = false;
    const id = q.enqueue(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          if (signal.aborted) {
            observedAbort = true;
            resolve();
            return;
          }
          signal.addEventListener("abort", () => {
            observedAbort = true;
            resolve();
          });
        }),
    );
    await tick();
    expect(q.cancel(id)).toBe(true);
    await tick();
    // The running job's fn observed the abort signal (not just a status flip).
    expect(observedAbort).toBe(true);
    expect(q.getJob(id)?.status).toBe("cancelled");
  });

  it("max_concurrency_bounds_concurrent_jobs", async () => {
    const q = new JobQueue({ maxConcurrency: 2 });
    let running = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const makeJob = () => () =>
      new Promise<void>((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        gates.push(() => {
          running -= 1;
          resolve();
        });
      });
    q.enqueue(makeJob());
    q.enqueue(makeJob());
    q.enqueue(makeJob());
    await tick();
    // At most 2 run concurrently; the 3rd waits for a slot.
    expect(peak).toBe(2);
    expect(gates.length).toBe(2);
    gates.shift()?.(); // finish one → the 3rd starts
    await tick();
    expect(gates.length).toBe(2); // still 2 slots occupied (job 3 now running)
  });

  it("default_unbounded_behavior_preserved", async () => {
    const q = new JobQueue(); // no maxConcurrency
    let running = 0;
    let peak = 0;
    const makeJob = () => () =>
      new Promise<void>((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        setTimeout(() => {
          running -= 1;
          resolve();
        }, 5);
      });
    for (let i = 0; i < 5; i++) q.enqueue(makeJob());
    await tick();
    expect(peak).toBe(5); // all ran at once (backward-compat)
  });

  it("maxConcurrency_below_one_is_clamped (EC-6)", () => {
    // Invalid input must not deadlock — clamp to >= 1.
    const q = new JobQueue({ maxConcurrency: 0 });
    let ran = false;
    q.enqueue(() => {
      ran = true;
      return Promise.resolve();
    });
    return tick().then(() => expect(ran).toBe(true));
  });
});
