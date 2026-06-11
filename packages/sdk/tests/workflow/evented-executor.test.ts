import { describe, expect, it } from "vitest";
import { EventedWorkflowExecutor } from "../../src/internal/workflow/evented-executor.js";
import type { Step, StepContext } from "../../src/types/workflow.js";

const echoStep: Step = {
  kind: "fn",
  id: "echo",
  fn: async (input: unknown) => input,
};

describe("EventedWorkflowExecutor", () => {
  it("creates an evented executor with steps", () => {
    const executor = new EventedWorkflowExecutor({
      name: "test-evented",
      steps: [echoStep],
    });
    expect(executor).toBeDefined();
    expect(executor.name).toEqual("test-evented");
    executor.dispose();
  });

  it("runs steps and returns completed status", async () => {
    const executor = new EventedWorkflowExecutor({
      name: "test-run",
      steps: [echoStep],
    });
    const result = await executor.run({ message: "hello" });
    expect(result.status).toEqual("completed");
    expect(result.output).toEqual({ message: "hello" });
    executor.dispose();
  });

  it("suspends with data and resumes", async () => {
    const suspendStep: Step = {
      kind: "fn",
      id: "needs-approval",
      fn: async (_input: unknown, ctx: StepContext) => {
        ctx.suspend("approval");
      },
    };
    const executor = new EventedWorkflowExecutor({
      name: "test-suspend",
      steps: [suspendStep, echoStep],
    });
    const state = await executor.run({});
    expect(state.status).toEqual("suspended");
    expect(state.suspendedAt).toEqual("approval");

    const resumed = await executor.resume(state.runId, { approved: true });
    expect(resumed.status).toEqual("completed");
    executor.dispose();
  });

  it("propagates AbortSignal", async () => {
    const slowStep: Step = {
      kind: "fn",
      id: "slow",
      fn: async (_input: unknown, ctx: { signal: AbortSignal }) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
      },
    };
    const controller = new AbortController();
    const executor = new EventedWorkflowExecutor({
      name: "test-abort",
      steps: [slowStep],
    });
    const runPromise = executor.run({}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    const result = await runPromise;
    expect(result.status).toEqual("error");
    executor.dispose();
  });

  it("EC-3: dispose stops internal scheduler", () => {
    const executor = new EventedWorkflowExecutor({
      name: "test-dispose",
      steps: [echoStep],
      schedule: "*/5 * * * *",
    });
    expect(executor.isScheduled).toEqual(true);
    executor.dispose();
    expect(executor.isScheduled).toEqual(false);
  });

  it("Symbol.dispose calls dispose", () => {
    const executor = new EventedWorkflowExecutor({
      name: "test-symbol-dispose",
      steps: [echoStep],
      schedule: "*/1 * * * *",
    });
    executor[Symbol.dispose]();
    expect(executor.isScheduled).toEqual(false);
  });
});
