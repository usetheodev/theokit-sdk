/**
 * T3.3 — `Agent.batch(prompts, { task })` adapter integration tests.
 * Uses fixture mode (no real LLM call).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/agent.js";
import { __resetTaskRegistryForTests } from "../../src/internal/task/registry.js";
import { Task } from "../../src/task.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

// This file passed `cwd: process.cwd()`, which during a test run is the package itself, so
// every agent it created persisted a real session into packages/sdk/.theokit/. The helper
// makes process.cwd() report a throwaway directory for this file only.
useTempCwd();

const FIXTURE_KEY = "theo_test_batch_task";

describe("Agent.batch({ task }) — D363 opt-in", () => {
  beforeEach(() => __resetTaskRegistryForTests());
  afterEach(() => __resetTaskRegistryForTests());

  it("backward compat: batch without task option does not register tasks", async () => {
    const results = await Agent.batch(["one", "two"], {
      apiKey: FIXTURE_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
      concurrency: 2,
    });
    expect(results.length).toBe(2);
    const tasks = await Task.list({});
    expect(tasks.length).toBe(0);
  });

  it("with task: true → registers one batch task with b- prefix", async () => {
    const results = await Agent.batch(["a", "b", "c"], {
      apiKey: FIXTURE_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
      concurrency: 2,
      task: true,
    });
    expect(results.length).toBe(3);
    const tasks = await Task.list({ kind: "batch" });
    expect(tasks.length).toBe(1);
    const task = tasks[0];
    expect(task?.id.startsWith("b-")).toBe(true);
    expect(task?.state).toBe("finished");
    expect((task?.meta as { total?: number })?.total).toBe(3);
  });

  it("with task: { id } → respects user-supplied id", async () => {
    await Agent.batch(["x", "y"], {
      apiKey: FIXTURE_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
      task: { id: "b-customer-batch-7" },
    });
    const h = await Task.get("b-customer-batch-7");
    expect(h?.state).toBe("finished");
    expect(h?.kind).toBe("batch");
  });

  it("with task: { meta } → meta merges with total", async () => {
    await Agent.batch(["q"], {
      apiKey: FIXTURE_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
      task: { meta: { customerId: "c-9", batchTag: "demo" } },
    });
    const tasks = await Task.list({ kind: "batch" });
    const meta = tasks[0]?.meta as { customerId?: string; total?: number; batchTag?: string };
    expect(meta?.customerId).toBe("c-9");
    expect(meta?.total).toBe(1);
    expect(meta?.batchTag).toBe("demo");
  });
});
