/**
 * Phase 4 (T4.1) — public `Task` facade tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetTaskRegistryForTests } from "../src/internal/task/registry.js";
import { Task } from "../src/task.js";
import type { RunEvent } from "../src/types/run-events.js";

describe("Task — onRunEvent bridge (SE2 task_*)", () => {
  beforeEach(() => __resetTaskRegistryForTests());
  afterEach(() => __resetTaskRegistryForTests());

  it("forwards task lifecycle to onRunEvent as RunEvents", async () => {
    const events: RunEvent[] = [];
    await Task.submit("custom", async () => "done", {
      onRunEvent: (e) => events.push(e),
    });
    // let the async work run to completion
    await new Promise((r) => setTimeout(r, 100));

    const types = events.map((e) => e.type);
    expect(types).toContain("task_started");
    const completed = events.find((e) => e.type === "task_completed");
    expect(completed).toBeDefined();
    expect((completed as { status?: string })?.status).toBe("completed");
  });

  it("maps a failed task to task_completed status 'failed'", async () => {
    const events: RunEvent[] = [];
    await Task.submit(
      "custom",
      async () => {
        throw new Error("boom");
      },
      { onRunEvent: (e) => events.push(e) },
    );
    await new Promise((r) => setTimeout(r, 100));
    const completed = events.find((e) => e.type === "task_completed");
    expect((completed as { status?: string })?.status).toBe("failed");
  });
});

describe("Task — public facade (D361)", () => {
  beforeEach(() => __resetTaskRegistryForTests());
  afterEach(() => __resetTaskRegistryForTests());

  it("static class constructor throws", () => {
    expect(() => new (Task as unknown as new () => unknown)()).toThrow(
      /Task is static; do not instantiate/,
    );
  });

  it("submit returns a queued handle", async () => {
    const handle = await Task.submit("custom", async () => "x");
    expect(handle.state).toBe("queued");
    expect(typeof handle.id).toBe("string");
  });

  it("list returns an array", async () => {
    await Task.submit("custom", async () => "a");
    const all = await Task.list({});
    expect(Array.isArray(all)).toBe(true);
  });

  it("get returns handle or undefined", async () => {
    const handle = await Task.submit("custom", async () => 1);
    expect((await Task.get(handle.id))?.id).toBe(handle.id);
    expect(await Task.get("definitely-missing")).toBeUndefined();
  });

  it("cancel returns idempotent shape", async () => {
    const r = await Task.cancel("never-existed");
    expect(r).toHaveProperty("cancelled");
    expect(r).toHaveProperty("alreadyTerminal");
  });

  it("subscribe returns an async iterable", async () => {
    const handle = await Task.submit("custom", async () => "ok");
    const sub = Task.subscribe(handle.id);
    expect(typeof (sub as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator]).toBe(
      "function",
    );
  });

  it("Task.configure before any submit applies", async () => {
    Task.configure({ maxConcurrent: 3 });
    const h = await Task.submit("custom", async () => "y");
    expect(h.state).toBe("queued");
  });
});
