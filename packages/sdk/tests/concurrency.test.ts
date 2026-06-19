import { describe, expect, it } from "vitest";

import { createSemaphore, mapWithConcurrency } from "../src/concurrency.js";

/**
 * M0-2 (plan m0-foundation-expose-primitives, T3.1) — `@theokit/sdk/concurrency`.
 *
 * Contract (sealed by these tests):
 *   - `createSemaphore` re-exported from the public subpath
 *   - `mapWithConcurrency` preserves input order in the result array
 *   - respects the concurrency ceiling (peak in-flight <= N)
 *   - empty array -> empty result; invalid concurrency throws
 *   - fail-fast: rejects with the first task error
 *   - aborted signal stops new work
 */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("test_createSemaphore_reexported_from_concurrency_subpath", () => {
    expect(typeof createSemaphore).toBe("function");
    expect(typeof mapWithConcurrency).toBe("function");
  });

  it("test_mapWithConcurrency_preserves_order_under_jitter", async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      await delay((6 - n) * 5);
      return n * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10]);
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
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow();
    await expect(mapWithConcurrency([1], -1, async (n) => n)).rejects.toThrow();
    await expect(mapWithConcurrency([1], 1.5, async (n) => n)).rejects.toThrow();
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
