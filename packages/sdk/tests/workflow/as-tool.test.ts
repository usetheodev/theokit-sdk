import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { WorkflowToolError, workflowAsTool } from "../../src/workflow.js";

/**
 * SE19 — `workflowAsTool(workflow, spec)` exposes a `Workflow` as an agent
 * `CustomTool`, completing the a peer framework "X as tools" trio (tools; agents-as-tools
 * via `SubAgent`; workflows-as-tools). The caller supplies the tool
 * `inputSchema` (a `Workflow` carries no top-level schema); the handler validates
 * the input, runs the workflow, and returns its output. A failed run raises a
 * typed `WorkflowToolError`.
 */
describe("workflowAsTool (SE19)", () => {
  const completedRun = (output: unknown) => ({
    id: "r1",
    name: "wf",
    status: "completed" as const,
    output,
    startedAt: 0,
    stepResults: [],
  });

  it("runs the workflow with the parsed input and returns its output", async () => {
    const workflow = { run: vi.fn().mockResolvedValue(completedRun({ result: 42 })) };
    const tool = workflowAsTool(workflow, {
      name: "calc",
      description: "Runs a calculation workflow",
      inputSchema: z.object({ x: z.number() }),
    });

    const result = (await tool.handler({ x: 5 })) as string;

    expect(workflow.run).toHaveBeenCalledWith({ x: 5 }); // parsed input forwarded
    expect(JSON.parse(result)).toEqual({ result: 42 });
    expect(tool.name).toBe("calc");
    expect(tool.inputSchema).toBeDefined(); // derived from the caller's inputSchema
  });

  it("returns a string output as-is (not JSON-quoted)", async () => {
    const workflow = { run: vi.fn().mockResolvedValue(completedRun("plain answer")) };
    const tool = workflowAsTool(workflow, {
      name: "echo",
      description: "Echo workflow",
      inputSchema: z.object({ text: z.string() }),
    });
    expect(await tool.handler({ text: "hi" })).toBe("plain answer");
  });

  it("raises a typed WorkflowToolError when the run fails", async () => {
    const workflow = {
      run: vi.fn().mockResolvedValue({
        id: "r1",
        name: "wf",
        status: "failed" as const,
        error: { name: "StepError", message: "step 2 exploded" },
        startedAt: 0,
        stepResults: [],
      }),
    };
    const tool = workflowAsTool(workflow, {
      name: "calc",
      description: "Runs a calculation workflow",
      inputSchema: z.object({ x: z.number() }),
    });

    await expect(tool.handler({ x: 5 })).rejects.toBeInstanceOf(WorkflowToolError);
    await expect(tool.handler({ x: 5 })).rejects.toThrow(/step 2 exploded|failed/);
  });

  it("rejects an input that fails the inputSchema (typed ZodError before running)", async () => {
    const workflow = { run: vi.fn().mockResolvedValue(completedRun("x")) };
    const tool = workflowAsTool(workflow, {
      name: "calc",
      description: "Runs a calculation workflow",
      inputSchema: z.object({ x: z.number() }),
    });
    // Measured: ZodError from the tool's input schema.
    // biome-ignore lint/suspicious/noExplicitAny: intentionally invalid input for the negative case.
    await expect(tool.handler({ x: "not-a-number" } as any)).rejects.toThrow(
      /"expected": "number"/,
    );
    expect(workflow.run).not.toHaveBeenCalled(); // never ran with invalid input
  });
});
