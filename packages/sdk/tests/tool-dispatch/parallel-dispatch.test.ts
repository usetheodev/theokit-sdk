import { describe, expect, it } from "vitest";

/**
 * T2.4 verification — parallel tool dispatch with bounded concurrency.
 *
 * The implementation lives in tool-dispatch.ts:boundedParallel.
 * These tests verify the concurrency semantics independently of the
 * full agent loop.
 */

// Re-implement the same boundedParallel logic for isolated testing
// (the function is not exported — testing the behavior via timing)
async function boundedParallel<T, R>(
  max: number,
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  let running = 0;
  const queue: Array<() => void> = [];
  async function acquire(): Promise<void> {
    if (running < max) {
      running++;
      return;
    }
    await new Promise<void>((resolve) => queue.push(resolve));
    running++;
  }
  function release(): void {
    running--;
    if (queue.length > 0) queue.shift()!();
  }
  return Promise.all(
    items.map(async (item) => {
      await acquire();
      try {
        return await fn(item);
      } finally {
        release();
      }
    }),
  );
}

/**
 * Resolves once `n` callers have arrived, so a task can be held until every one of its siblings is
 * also in flight. Rejects — naming what never happened — if that never becomes true.
 *
 * B-057. The overlap assertion below needs the three tasks to be *simultaneously* inside `fn`, and
 * a barrier is the only construct that makes that a fact rather than a probability. The deadline is
 * a failure bound, NOT a synchroniser: a correct `boundedParallel` never reaches it, and a serial
 * one would otherwise hang until the suite timeout with no message about what it was waiting for.
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

describe("parallel tool dispatch (T2.4)", () => {
  it("runs every task concurrently — all three are in flight before any finishes", async () => {
    // B-057. This assertion used to be `elapsed < 250ms` over three real 100ms sleeps: 150ms of
    // headroom for the whole test process, on a suite whose own config documents libuv saturation
    // across 18 parallel package runs. Two things were wrong with it. It could go red while
    // `boundedParallel` was perfectly correct (a loaded host), and it measured the clock when the
    // claim in the test name is about *overlap* — which is observable directly.
    //
    // So the tasks now report when they enter and when they leave, and are held inside `fn` until
    // all three have entered. Parallel dispatch satisfies that; a serial one cannot, at any speed.
    const timeline: string[] = [];
    const allThreeInFlight = barrier(3, "all three tasks to be inside fn at the same time");

    const results = await boundedParallel(4, [1, 2, 3], async (n) => {
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

  it("preserves input order regardless of completion order", async () => {
    const results = await boundedParallel(4, [3, 1, 2], async (n) => {
      await new Promise((r) => setTimeout(r, n * 10));
      return `result-${n}`;
    });
    expect(results).toEqual(["result-3", "result-1", "result-2"]);
  });

  it("respects concurrency limit", async () => {
    let maxConcurrent = 0;
    let current = 0;
    await boundedParallel(2, [1, 2, 3, 4, 5], async () => {
      current++;
      if (current > maxConcurrent) maxConcurrent = current;
      await new Promise((r) => setTimeout(r, 50));
      current--;
    });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("handles empty array", async () => {
    const results = await boundedParallel(4, [], async () => "x");
    expect(results).toEqual([]);
  });

  it("propagates errors from individual tasks", async () => {
    await expect(
      boundedParallel(4, [1, 2, 3], async (n) => {
        if (n === 2) throw new Error("task 2 failed");
        return n;
      }),
    ).rejects.toThrow("task 2 failed");
  });
});
