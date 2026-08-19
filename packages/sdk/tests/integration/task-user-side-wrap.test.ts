/**
 * Phase 3 (T3.2-T3.5) integration tests — demonstrating user-side
 * wrapping of arbitrary async work via `Task.submit`.
 *
 * Scope cut (v1.1): we do NOT modify `Agent.send` / `Agent.batch` /
 * `Workflow.run` / `Cron.register` to add an `{ task: true }` option.
 * Instead, the public `Task.submit` primitive is composable enough that
 * callers wrap their own async work in 2-3 lines. Adapter integration
 * into core options bags is deferred to v0.2 (see plan v1.2 scope note).
 *
 * These tests document the supported patterns + verify they pass through
 * the registry events correctly.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetTaskRegistryForTests } from "../../src/internal/task/registry.js";
import { Task } from "../../src/task.js";

/**
 * Awaits a task's terminal event on the stream `Task.subscribe` already exposes.
 *
 * B-054. Five call sites in this file used `await new Promise(r => setTimeout(r, N))` and then read
 * `Task.get`, with N picked by guess (50, 100, 20, 30, 10). The runtime announces every transition —
 * waiting on the clock instead was ignoring the signal being waited for. A blind sleep is also
 * silently wrong in both directions: too short and the test flakes under load, too long and it pays
 * the cost on every run forever.
 */
/**
 * Polls `Task.get` until the task reaches a terminal state.
 *
 * Distinct from `awaitTerminal` on purpose: this one does NOT consume the event stream, so a test
 * that must attach a subscriber afterwards still finds the events waiting in the ring buffer.
 *
 * Note the two vocabularies — the STATE is `"error"` while the EVENT is `"errored"`. `tsc` caught me
 * using the event name here.
 */
async function pollUntilTerminal(taskId: string): Promise<void> {
  let state = (await Task.get(taskId))?.state;
  while (state !== "finished" && state !== "error" && state !== "cancelled") {
    await new Promise((r) => setImmediate(r));
    state = (await Task.get(taskId))?.state;
  }
}

/** Polls until the task is actually running — i.e. its work callback has registered its listeners. */
async function pollUntilRunning(taskId: string): Promise<void> {
  while ((await Task.get(taskId))?.state !== "running") {
    await new Promise((r) => setImmediate(r));
  }
}

async function awaitTerminal(taskId: string): Promise<void> {
  for await (const ev of Task.subscribe(taskId)) {
    if (ev.type === "finished" || ev.type === "cancelled" || ev.type === "errored") return;
  }
}

describe("Task — user-side wrap patterns", () => {
  beforeEach(() => __resetTaskRegistryForTests());
  afterEach(() => __resetTaskRegistryForTests());

  it("wraps a single async unit of work and produces a queued→finished trace", async () => {
    const handle = await Task.submit("run", async (ctx) => {
      ctx.emit({ step: "tick" });
      return "hello";
    });
    await awaitTerminal(handle.id);

    const final = await Task.get(handle.id);
    expect(final?.state).toBe("finished");
    expect(final?.result).toBe("hello");
  });

  it("supports a fan-out batch pattern via Task.submit per item", async () => {
    const items = ["a", "b", "c", "d"];
    const parent = await Task.submit("batch", async (ctx) => {
      const children = await Promise.all(
        items.map((item, idx) =>
          Task.submit(
            "run",
            async (childCtx) => {
              childCtx.emit({ item });
              return `processed:${item}`;
            },
            { meta: { parentId: ctx.signal ? "demo-parent" : undefined, idx } },
          ),
        ),
      );
      return { childCount: children.length };
    });
    await awaitTerminal(parent.id);

    const final = await Task.get(parent.id);
    expect(final?.state).toBe("finished");
    expect((final?.result as { childCount: number }).childCount).toBe(4);
  });

  it("supports cancel-aware long-running work (cron-like wrap)", async () => {
    let cancelled = false;
    const handle = await Task.submit("cron", async (ctx) => {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), 5000);
        ctx.signal.addEventListener("abort", () => {
          cancelled = true;
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
    });
    // B-054. Two sleeps here and they were doing DIFFERENT jobs — which I got wrong on the first
    // attempt, and the test caught me. I replaced both with a terminal-event wait, reasoning that
    // "cancel on a queued task cancels it just as well". It does cancel the task; it does not set
    // `cancelled`, because that flag is set by the abort listener registered INSIDE the work
    // callback. Cancel before the work starts and there is no listener: `expected false to be true`.
    //
    // So the first wait is load-bearing — it waits for the work to be RUNNING, which is what makes
    // the abort observable — and the second waits for the cancellation to land. Both are now waits
    // for a state the registry reports, rather than guesses at how long each takes.
    await pollUntilRunning(handle.id);

    await Task.cancel(handle.id);
    await awaitTerminal(handle.id);

    expect(cancelled).toBe(true);
    expect((await Task.get(handle.id))?.state).toBe("cancelled");
  });

  it("emits progress events that subscribers can observe (workflow-like pattern)", async () => {
    const steps: unknown[] = [];
    const handle = await Task.submit("workflow", async (ctx) => {
      for (let i = 0; i < 3; i++) {
        ctx.emit({ step: i });
        await new Promise((r) => setTimeout(r, 5));
      }
      return "done";
    });

    // B-054. This sleep is NOT the same defect as the other four: it is load-bearing, because the
    // property under test is that a LATE subscriber still receives buffered events. But 10ms only
    // makes "late" probable — under load the subscribe can still win the race, and then the test
    // passes while exercising the early-attach path it is not named for.
    //
    // Polling until the task is terminal makes "late" guaranteed rather than likely, which is a
    // stronger version of the same test. `Task.get` is the read side and does not consume the
    // stream, so it cannot steal the events the subscriber must find in the buffer.
    await pollUntilTerminal(handle.id);

    const sub = Task.subscribe(handle.id);
    for await (const ev of sub) {
      if (ev.type === "progress") steps.push(ev.payload);
      if (ev.type === "finished" || ev.type === "errored" || ev.type === "cancelled") break;
    }
    expect(steps.length).toBeGreaterThan(0);
  });
});
