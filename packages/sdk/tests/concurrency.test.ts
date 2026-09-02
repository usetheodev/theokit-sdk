import { describe, expect, it } from "vitest";

import { mapWithConcurrency, Semaphore } from "../src/concurrency.js";
import { ConfigurationError } from "../src/errors.js";

/**
 * M0-2 (plan m0-foundation-expose-primitives, T3.1) — `@theokit/sdk/concurrency`.
 *
 * Contract (sealed by these tests):
 *   - `Semaphore` re-exported from the public subpath
 *   - `mapWithConcurrency` preserves input order in the result array
 *   - respects the concurrency ceiling (peak in-flight <= N)
 *   - runs tasks genuinely concurrently (not serially) — see the barrier test below
 *   - empty array -> empty result; invalid concurrency throws
 *   - fail-fast: rejects with the first task error
 *   - aborted signal stops new work
 */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Resolves once `n` callers have arrived, so a task can be held until every one of its
 * siblings is also in flight. Rejects — naming what never happened — if that never becomes
 * true. B-057/B-109: a barrier is the only construct that makes "these ran concurrently" a
 * fact rather than a timing probability; the deadline is a failure bound, not a synchroniser.
 */
function barrier(n: number, description: string, timeoutMs = 5_000): () => Promise<void> {
  let arrived = 0;
  let open!: () => void;
  let fail!: (err: Error) => void;
  const gate = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  const timer = setTimeout(
    () => fail(new Error(`timed out after ${timeoutMs}ms waiting for: ${description}`)),
    timeoutMs,
  );
  timer.unref();
  return async function arrive(): Promise<void> {
    arrived += 1;
    if (arrived === n) {
      clearTimeout(timer);
      open();
    }
    return gate;
  };
}

describe("mapWithConcurrency", () => {
  it("test_createSemaphore_reexported_from_concurrency_subpath", () => {
    expect(typeof Semaphore).toBe("function");
    expect(typeof mapWithConcurrency).toBe("function");
  });

  it("test_mapWithConcurrency_preserves_order_under_jitter", async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      await delay((6 - n) * 5);
      return n * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  it("test_mapWithConcurrency_runs_every_task_concurrently_not_serially", async () => {
    // B-109 — this replaces `tests/tool-dispatch/parallel-dispatch.test.ts`, which asserted
    // this same property against a LOCAL re-implementation of `boundedParallel` the file
    // declared for itself, never against the production `mapWithConcurrency` it was meant to
    // stand in for (production consolidated onto `mapWithConcurrency` in
    // `internal/agent-loop/tool-dispatch.ts` — see that file's M0-2 comment). No assertion in
    // that file could ever fail for a regression in this real function. Order/limit/empty/
    // error coverage above is unaffected by the deletion — this is the one property (true
    // 3-way overlap, not just "did not obviously serialize") that file proved and this one
    // did not yet cover.
    const timeline: string[] = [];
    const allThreeInFlight = barrier(3, "all three tasks to be inside fn at the same time");

    const results = await mapWithConcurrency([1, 2, 3], 4, async (n) => {
      timeline.push(`enter:${n}`);
      await allThreeInFlight();
      timeline.push(`exit:${n}`);
      return n * 10;
    });

    expect(results, "results must still come back in input order").toEqual([10, 20, 30]);
    expect(
      timeline.slice(0, 3).sort(),
      "every task must have started before any task finished",
    ).toEqual(["enter:1", "enter:2", "enter:3"]);
    expect(timeline.slice(3).sort(), "and all three must then finish").toEqual([
      "exit:1",
      "exit:2",
      "exit:3",
    ]);
  });

  it("test_mapWithConcurrency_respects_max_concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await delay(5);
      inFlight -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("test_mapWithConcurrency_empty_array_returns_empty", async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
  });

  it("test_mapWithConcurrency_throws_on_invalid_concurrency", async () => {
    // B-079 — was a bare `.rejects.toThrow()`. `createSemaphore` (the actual
    // validator behind `mapWithConcurrency`) throws `ConfigurationError` with
    // `code: "invalid_concurrency"` (src/internal/concurrency/async-semaphore.ts).
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow(ConfigurationError);
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toMatchObject({
      code: "invalid_concurrency",
    });
    await expect(mapWithConcurrency([1], -1, async (n) => n)).rejects.toThrow(ConfigurationError);
    await expect(mapWithConcurrency([1], -1, async (n) => n)).rejects.toMatchObject({
      code: "invalid_concurrency",
    });
    await expect(mapWithConcurrency([1], 1.5, async (n) => n)).rejects.toThrow(ConfigurationError);
    await expect(mapWithConcurrency([1], 1.5, async (n) => n)).rejects.toMatchObject({
      code: "invalid_concurrency",
    });
  });

  it("test_mapWithConcurrency_rejects_on_first_error", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("test_mapWithConcurrency_stops_new_work_after_abort", async () => {
    const controller = new AbortController();
    let started = 0;
    const run = mapWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      1,
      async (n) => {
        started += 1;
        await delay(5);
        if (n === 1) controller.abort();
        return n;
      },
      { signal: controller.signal },
    ).catch(() => undefined);
    await run;
    expect(started).toBeLessThan(6);
  });
});
