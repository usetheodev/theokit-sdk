/**
 * Concurrency primitives — a counting semaphore + ordered bounded map. Deterministic (no LLM).
 */
import { Semaphore, mapWithConcurrency } from "@theokit/sdk/concurrency";

const sem = Semaphore.create(2); // at most 2 concurrent holders
let active = 0;
let peak = 0;

const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
  const release = await sem.acquire();
  active += 1;
  peak = Math.max(peak, active);
  await new Promise((r) => setTimeout(r, 10));
  active -= 1;
  release();
  return n * 10;
});

console.log("Results:", results.join(", "));
console.log("Peak concurrency:", peak, "(cap was 2)");
