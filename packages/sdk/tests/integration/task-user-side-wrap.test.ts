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

describe("Task — user-side wrap patterns", () => {
  beforeEach(() => __resetTaskRegistryForTests());
  afterEach(() => __resetTaskRegistryForTests());

  it("wraps a single async unit of work and produces a queued→finished trace", async () => {
    const handle = await Task.submit("run", async (ctx) => {
      ctx.emit({ step: "tick" });
      return "hello";
    });
    await new Promise((r) => setTimeout(r, 50));
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
    await new Promise((r) => setTimeout(r, 100));
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
    await new Promise((r) => setTimeout(r, 20));
    await Task.cancel(handle.id);
    await new Promise((r) => setTimeout(r, 30));
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

    // Subscribe a tick later (events should still be in the ring buffer)
    await new Promise((r) => setTimeout(r, 10));
    const sub = Task.subscribe(handle.id);
    for await (const ev of sub) {
      if (ev.type === "progress") steps.push(ev.payload);
      if (ev.type === "finished" || ev.type === "errored" || ev.type === "cancelled") break;
    }
    expect(steps.length).toBeGreaterThan(0);
  });
});
