import { describe, expect, it } from "vitest";
import { EventedWorkflowExecutor } from "../../src/internal/workflow/evented-executor.js";
import type { StepContext } from "../../src/types/workflow.js";

describe("workflow execution", () => {
  it("multi-step workflow runs to completion", async () => {
    const executor = new EventedWorkflowExecutor({
      name: "e2e-pipeline",
      steps: [
        {
          kind: "fn",
          id: "step1",
          fn: async (input: unknown) => ({ ...(input as object), step1: true }),
        },
        {
          kind: "fn",
          id: "step2",
          fn: async (input: unknown) => ({ ...(input as object), step2: true }),
        },
      ],
    });
    const result = await executor.run({ initial: true });
    expect(result.status).toEqual("completed");
    expect(result.output).toEqual({ initial: true, step1: true, step2: true });
    executor.dispose();
  });

  it("workflow suspend and resume", async () => {
    const executor = new EventedWorkflowExecutor({
      name: "e2e-suspend",
      steps: [
        {
          kind: "fn",
          id: "needs-approval",
          fn: async (_input: unknown, ctx: StepContext) => ctx.suspend("human-review"),
        },
        { kind: "fn", id: "final", fn: async (input: unknown) => input },
      ],
    });
    const state = await executor.run({ data: "test" });
    expect(state.status).toEqual("suspended");
    const result = await executor.resume(state.runId, { approved: true });
    expect(result.status).toEqual("completed");
    executor.dispose();
  });
});
