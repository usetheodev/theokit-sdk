/**
 * Phase 4 (T4.1) — public `Task` facade tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetTaskRegistryForTests } from "../src/internal/task/registry.js";
import { Task } from "../src/task.js";

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
