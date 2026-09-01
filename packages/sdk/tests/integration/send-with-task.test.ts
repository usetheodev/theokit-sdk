/**
 * T3.2 — `Agent.send(prompt, { task })` adapter integration tests.
 *
 * Uses fixture-mode (theo_test_*) so no real LLM call is needed. The
 * point is verifying the Task registry observes the run lifecycle —
 * the LLM stream content is irrelevant.
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

const FIXTURE_KEY = "theo_test_send_task";

describe("Agent.send({ task: true }) — D363 opt-in", () => {
  beforeEach(() => __resetTaskRegistryForTests());
  afterEach(async () => {
    __resetTaskRegistryForTests();
  });

  it("backward compat: send without task option still returns Run", async () => {
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
    });
    try {
      const run = await agent.send("hello");
      expect(run.id).toBeDefined();
      await run.wait();
      // No task should have been registered
      const tasks = await Task.list({ kind: "run" });
      expect(tasks.length).toBe(0);
    } finally {
      await agent.dispose();
    }
  });

  it("with task: true → registers a 'run' task observable via Task.list", async () => {
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
    });
    try {
      const run = await agent.send("hello world", { task: true });
      await run.wait();
      await new Promise((r) => setTimeout(r, 50));
      const tasks = await Task.list({ kind: "run" });
      expect(tasks.length).toBe(1);
      const task = tasks[0];
      expect(task?.kind).toBe("run");
      expect((task?.meta as { agentId?: string })?.agentId).toBe(agent.agentId);
      expect((task?.meta as { runId?: string })?.runId).toBe(run.id);
    } finally {
      await agent.dispose();
    }
  });

  it("with task: { id } → respects user-supplied id (D368 grammar)", async () => {
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
    });
    try {
      const run = await agent.send("hi", { task: { id: "my-send-task" } });
      await run.wait();
      await new Promise((r) => setTimeout(r, 50));
      const handle = await Task.get("my-send-task");
      expect(handle?.kind).toBe("run");
      expect(handle?.state).toBe("finished");
    } finally {
      await agent.dispose();
    }
  });

  it("with task: { meta } → meta merges with the runtime meta", async () => {
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
    });
    try {
      const run = await agent.send("foo", {
        task: { meta: { customerId: "cust-1" } },
      });
      await run.wait();
      await new Promise((r) => setTimeout(r, 50));
      const tasks = await Task.list({ kind: "run" });
      const meta = tasks[0]?.meta as { customerId?: string; agentId?: string };
      expect(meta?.customerId).toBe("cust-1");
      expect(meta?.agentId).toBe(agent.agentId);
    } finally {
      await agent.dispose();
    }
  });
});
