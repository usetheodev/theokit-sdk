import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { Step } from "../src/decorators/step.js";
import { Workflow } from "../src/decorators/workflow.js";
import { buildWorkflow } from "../src/workflow-builder.js";

describe("buildWorkflow — compiles @Step class into a @theokit/sdk Workflow", () => {
  it("test_buildWorkflow_runs_steps_in_after_order_threading_output", async () => {
    const seen: string[] = [];
    @Workflow({ name: "pipe" })
    class Pipe {
      @Step()
      a(prev: unknown): string {
        seen.push(String(prev));
        return `${String(prev)}>a`;
      }
      @Step({ after: "a" })
      b(prev: unknown): string {
        seen.push(String(prev));
        return `${String(prev)}>b`;
      }
      @Step({ after: "b" })
      c(prev: unknown): string {
        seen.push(String(prev));
        return `${String(prev)}>c`;
      }
    }
    const wf = buildWorkflow(new Pipe());
    const run = await wf.run("start");
    expect(seen).toEqual(["start", "start>a", "start>a>b"]);
    expect(run.output).toBe("start>a>b>c");
    expect(run.status).toBe("completed");
    // composition proof: run is a real WorkflowRun (stepResults from the engine)
    expect(run.stepResults).toHaveLength(3);
  });

  it("test_after_order_independent_of_declaration_order", async () => {
    class Reordered {
      @Step({ after: "first" })
      second(prev: unknown): string {
        return `${String(prev)}>2`;
      }
      @Step()
      first(prev: unknown): string {
        return `${String(prev)}>1`;
      }
    }
    const run = await buildWorkflow(new Reordered()).run("x");
    expect(run.output).toBe("x>1>2");
  });

  it("test_buildWorkflow_rejects_no_steps", () => {
    class Empty {}
    expect(() => buildWorkflow(new Empty())).toThrowError(/no @Step/i);
  });

  it("test_rejects_unknown_after", () => {
    class Bad {
      @Step({ after: "ghost" })
      a(): void {}
    }
    expect(() => buildWorkflow(new Bad())).toThrowError(/ghost|unknown/i);
  });

  it("test_rejects_cycle", () => {
    class Cyclic {
      @Step({ after: "b" })
      a(): void {}
      @Step({ after: "a" })
      b(): void {}
    }
    expect(() => buildWorkflow(new Cyclic())).toThrowError(/cycle|cyclic/i);
  });
});
