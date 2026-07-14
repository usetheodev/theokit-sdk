import { describe, expect, it } from "vitest";
import { JobQueue } from "../src/job-queue.js";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/**
 * #58 (adversarial-review gap) — cancelling a RUNNING non-cooperative job
 * (one that ignores the AbortSignal and never settles) must free its
 * concurrency slot immediately. Previously `#release` was coupled to the job
 * promise settling (`.finally`), so a hung job that ignored `cancel()` leaked
 * the slot forever → a bounded queue starved every subsequent job (deadlock).
 *
 * RED (pre-fix): the follow-up job never runs.
 */
describe("JobQueue cancel frees the slot of a hung running job (#58)", () => {
  it("does not deadlock a bounded queue when a running job ignores cancel", async () => {
    const q = new JobQueue({ maxConcurrency: 1 });

    // A job that never settles and ignores the abort signal.
    const hung = q.enqueue(() => new Promise<void>(() => {}));
    await tick(); // let it acquire the only slot and start running

    expect(q.cancel(hung)).toBe(true);

    let ran = false;
    q.enqueue(async () => {
      ran = true;
    });
    await tick(40);

    // Slot must have been freed by cancel → the follow-up runs.
    expect(ran).toBe(true);
  });

  it("does not over-release when a cancelled job later settles (no double free)", async () => {
    const q = new JobQueue({ maxConcurrency: 1 });
    let releaseHung: (() => void) | undefined;

    // A job we can settle on demand, AFTER we cancel it.
    const hung = q.enqueue(
      () =>
        new Promise<void>((resolve) => {
          releaseHung = resolve;
        }),
    );
    await tick();
    q.cancel(hung);
    releaseHung?.(); // the cancelled job's promise settles late → .finally fires
    await tick();

    // Now a burst of 3 must still run one-at-a-time (running never went negative,
    // which would let >1 run or corrupt the bound).
    let peak = 0;
    let live = 0;
    const mk = () =>
      q.enqueue(async () => {
        live += 1;
        peak = Math.max(peak, live);
        await tick(10);
        live -= 1;
      });
    mk();
    mk();
    mk();
    await tick(80);
    expect(peak).toBe(1);
  });
});
