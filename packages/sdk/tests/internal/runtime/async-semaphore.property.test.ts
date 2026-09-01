/**
 * Property tests for AsyncSemaphore (T5.1).
 *
 * Adversarial fast-check sweeps validating FIFO order, concurrency caps,
 * and acquire/release safety under randomized timing.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createSemaphore } from "../../../src/internal/concurrency/async-semaphore.js";

describe("AsyncSemaphore properties (T5.1)", () => {
  it("FIFO: waiters resume in acquisition order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 8 }),
        async (permits, extra) => {
          const sem = createSemaphore(permits);
          // Saturate.
          const holders = await Promise.all(Array.from({ length: permits }, () => sem.acquire()));
          // Queue `extra` waiters; each records its index when granted.
          const order: number[] = [];
          const waiters = Array.from({ length: extra }, (_, i) =>
            (async () => {
              const r = await sem.acquire();
              order.push(i);
              r();
            })(),
          );
          // Give the queue a tick to register all waiters.
          await new Promise((r) => setTimeout(r, 1));
          // Release holders one at a time.
          for (const h of holders) h();
          await Promise.all(waiters);
          expect(order).toEqual(Array.from({ length: extra }, (_, i) => i));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("inFlight never exceeds permits during random workload", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 4, maxLength: 12 }),
        async (permits, durations) => {
          const sem = createSemaphore(permits);
          let maxObserved = 0;
          await Promise.all(
            durations.map(async (d) => {
              const release = await sem.acquire();
              maxObserved = Math.max(maxObserved, sem.inFlight());
              await new Promise((r) => setTimeout(r, d));
              release();
            }),
          );
          expect(maxObserved).toBeLessThanOrEqual(permits);
          expect(sem.inFlight()).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("release is idempotent — extra calls are no-ops", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (permits) => {
        const sem = createSemaphore(permits);
        const r = await sem.acquire();
        expect(sem.inFlight()).toBe(1);
        r();
        r();
        r();
        expect(sem.inFlight()).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
