/**
 * T3.4 — `Workflow.run(input, { task })` adapter integration tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __resetTaskRegistryForTests } from "../../src/internal/task/registry.js";
import { Task } from "../../src/task.js";
import { fn, Workflow } from "../../src/workflow.js";

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
    // Give the registry a tick to finalize
    await new Promise((r) => setTimeout(r, 30));
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
    await new Promise((r) => setTimeout(r, 30));
    const h = await Task.get("wf-my-run-1");
    expect(h?.state).toBe("finished");
    expect(h?.kind).toBe("workflow");
  });

  it("with task: { meta } merges meta into the registered task", async () => {
    const wf = buildEchoWorkflow();
    await wf.run("y", { task: { meta: { customer: "c-1" } } });
    await new Promise((r) => setTimeout(r, 30));
    const tasks = await Task.list({ kind: "workflow" });
    const meta = tasks[0]?.meta as { customer?: string; workflowName?: string };
    expect(meta?.customer).toBe("c-1");
    expect(meta?.workflowName).toBe("echo");
  });
});
