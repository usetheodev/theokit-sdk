/**
 * T3.4 — `Workflow.run(input, { task })` adapter integration tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __resetTaskRegistryForTests } from "../../src/internal/task/registry.js";
import { Task } from "../../src/task.js";
import { fn, Workflow } from "../../src/workflow.js";
import { pollUntil } from "../helpers/poll-until.js";

describe("Workflow.run({ task }) — D363 opt-in", () => {
  beforeEach(() => __resetTaskRegistryForTests());
  afterEach(() => __resetTaskRegistryForTests());

  function buildEchoWorkflow() {
    return Workflow.create({ name: "echo" })
      .then(fn("step1", async (input: string) => `${input}-step1`))
      .then(fn("step2", async (input: string) => `${input}-step2`))
      .commit();
  }

  it("backward compat: workflow run without task option does not register tasks", async () => {
    const wf = buildEchoWorkflow();
    const result = await wf.run("input");
    expect(result.status).toBe("completed");
    expect(result.output).toBe("input-step1-step2");
    const tasks = await Task.list({});
    expect(tasks.length).toBe(0);
  });

  it("with task: true → registers a workflow task with wf- prefix", async () => {
    const wf = buildEchoWorkflow();
    const result = await wf.run("hello", { task: true });
    expect(result.status).toBe("completed");
    // Waits for the registry to HOLD the task, not for 30ms.
    // The condition has to be what the ASSERTIONS below read — the task registered AND settled.
    // Polling only for its existence returns earlier than the 30ms sleep did and the state is still
    // "running": swapping a sleep for a poll is only correct when the poll waits for the thing the
    // test is about, and the shorter wait is what exposes a condition that was too weak.
    await pollUntil(
      async () => (await Task.list({ kind: "workflow" })).some((t) => t.state === "finished"),
      {
        message: async () =>
          `no finished workflow task; states were ${JSON.stringify((await Task.list({ kind: "workflow" })).map((t) => t.state))}`,
      },
    );
    const tasks = await Task.list({ kind: "workflow" });
    expect(tasks.length).toBe(1);
    const t = tasks[0];
    expect(t?.id.startsWith("wf-")).toBe(true);
    expect((t?.meta as { workflowName?: string })?.workflowName).toBe("echo");
    expect(t?.state).toBe("finished");
  });

  it("with task: { id } → uses user-supplied id", async () => {
    const wf = buildEchoWorkflow();
    await wf.run("x", { task: { id: "wf-my-run-1" } });
    await pollUntil(async () => (await Task.get("wf-my-run-1"))?.state === "finished", {
      message: async () =>
        `task wf-my-run-1 never finished; state was ${String((await Task.get("wf-my-run-1"))?.state)}`,
    });
    const h = await Task.get("wf-my-run-1");
    expect(h?.state).toBe("finished");
    expect(h?.kind).toBe("workflow");
  });

  it("with task: { meta } merges meta into the registered task", async () => {
    const wf = buildEchoWorkflow();
    await wf.run("y", { task: { meta: { customer: "c-1" } } });
    // The condition has to be what the ASSERTIONS below read — the task registered AND settled.
    // Polling only for its existence returns earlier than the 30ms sleep did and the state is still
    // "running": swapping a sleep for a poll is only correct when the poll waits for the thing the
    // test is about, and the shorter wait is what exposes a condition that was too weak.
    await pollUntil(
      async () => (await Task.list({ kind: "workflow" })).some((t) => t.state === "finished"),
      {
        message: async () =>
          `no finished workflow task; states were ${JSON.stringify((await Task.list({ kind: "workflow" })).map((t) => t.state))}`,
      },
    );
    const tasks = await Task.list({ kind: "workflow" });
    const meta = tasks[0]?.meta as { customer?: string; workflowName?: string };
    expect(meta?.customer).toBe("c-1");
    expect(meta?.workflowName).toBe("echo");
  });
});
