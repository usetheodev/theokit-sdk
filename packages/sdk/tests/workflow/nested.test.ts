import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  cloneWorkflow,
  fn,
  Workflow,
  WorkflowDuplicateStepIdError,
  WorkflowNestedError,
  workflowStep,
} from "../../src/workflow.js";

/**
 * SE30 — workflows-as-steps (`workflowStep`) + `cloneWorkflow`. A committed
 * workflow runs as an opaque FnStep; its output flows on. A non-completed child
 * fails the parent step with a typed WorkflowNestedError (nested suspend is not
 * resumable in v1). Clones run independently under a new id.
 */

describe("SE30 — workflowStep (nested workflow as a step)", () => {
  it("a nested workflow's output flows into the parent", async () => {
    const child = Workflow.create({ name: "child" })
      .then(fn("double", (i: { n: number }) => ({ n: i.n * 2 })))
      .commit();

    const parent = Workflow.create({ name: "parent" })
      .then(fn("seed", () => ({ n: 5 })))
      .then(workflowStep(child, { id: "run-child" }))
      .then(fn("plus1", (i: { n: number }) => ({ n: i.n + 1 })))
      .commit();

    const run = await parent.run({});
    expect(run.status).toBe("completed");
    expect(run.output).toEqual({ n: 11 }); // 5*2 + 1
    // the nested workflow shows as ONE step in the parent (opaque).
    expect(run.stepResults.map((s) => s.stepId)).toEqual(["seed", "run-child", "plus1"]);
  });

  it("a nested failure fails the parent step (typed WorkflowNestedError)", async () => {
    const child = Workflow.create({ name: "boom-child" })
      .then(
        fn("bad", () => {
          throw new Error("child kaboom");
        }),
      )
      .commit();

    const parent = Workflow.create({ name: "parent2" }).then(workflowStep(child)).commit();

    const run = await parent.run({});
    expect(run.status).toBe("failed");
    expect(run.error?.name).toBe("WorkflowNestedError");
    expect(run.error?.message).toContain("boom-child");
    expect(run.error?.message).toContain("failed");
    // the child's ORIGINAL error message must survive into the nested error
    // (a regression that drops `childError` would otherwise pass silently).
    expect(run.error?.message).toContain("child kaboom");
  });

  it("aborting the parent mid-child fails with a cancelled childStatus", async () => {
    const controller = new AbortController();
    const child = Workflow.create({ name: "abort-child" })
      .then(
        fn("trip", async () => {
          controller.abort(); // abort while the child is executing
          await new Promise((r) => setTimeout(r, 0)); // yield so the loop observes it
          return { ok: true };
        }),
      )
      .then(fn("never", () => ({ reached: true })))
      .commit();

    const parent = Workflow.create({ name: "parent-abort" }).then(workflowStep(child)).commit();

    const run = await parent.run({}, { signal: controller.signal });
    expect(run.status).toBe("failed");
    expect(run.error?.name).toBe("WorkflowNestedError");
    expect(run.error?.message).toContain("cancelled");
  });

  it("a nested child with an outputSchema rejection surfaces as WorkflowNestedError", async () => {
    const child = Workflow.create({
      name: "schema-child",
      outputSchema: z.object({ n: z.number() }),
    })
      // returns a string where the schema demands { n: number } → child fails
      .then(fn("wrong", () => "not-an-object" as unknown))
      .commit();

    const parent = Workflow.create({ name: "parent-schema" }).then(workflowStep(child)).commit();

    const run = await parent.run({});
    expect(run.status).toBe("failed");
    expect(run.error?.name).toBe("WorkflowNestedError");
    expect(run.error?.message).toContain("WorkflowOutputError");
  });

  it("two same-named nested workflows without ids collide at commit (clear error)", () => {
    const child = Workflow.create({ name: "dup" })
      .then(fn("s", (i: unknown) => i))
      .commit();

    expect(() =>
      Workflow.create({ name: "parent-dup" })
        .then(workflowStep(child)) // id: "workflow_dup"
        .then(workflowStep(child)) // id: "workflow_dup" — duplicate
        .commit(),
    ).toThrowError(WorkflowDuplicateStepIdError);
  });

  it("WorkflowNestedError chains the child error as `cause` for debuggers", () => {
    const err = new WorkflowNestedError("step-x", "child-y", "failed", {
      name: "BoomError",
      message: "kaboom",
    });
    expect(err.cause).toBeInstanceOf(Error);
    expect((err.cause as Error).message).toBe("kaboom");
    expect((err.cause as Error).name).toBe("BoomError");
  });

  it("a nested suspend fails the parent (not resumable in v1, documented)", async () => {
    const child = Workflow.create({ name: "susp-child", persistence: { backend: "memory" } })
      .then(fn("pause", async (_i: unknown, ctx) => ctx.suspend({ ask: "x" })))
      .commit();

    const parent = Workflow.create({ name: "parent3" }).then(workflowStep(child)).commit();

    const run = await parent.run({});
    expect(run.status).toBe("failed");
    expect(run.error?.name).toBe("WorkflowNestedError");
    expect(run.error?.message).toContain("not supported in v1");
  });

  it("derives a step id from the child name when none is given", async () => {
    const child = Workflow.create({ name: "namedChild" })
      .then(fn("id", (i: unknown) => i))
      .commit();
    const parent = Workflow.create({ name: "parent4" }).then(workflowStep(child)).commit();
    const run = await parent.run({ ok: true });
    expect(run.stepResults[0]?.stepId).toBe("workflow_namedChild");
  });
});

describe("SE30 — cloneWorkflow", () => {
  it("a clone runs independently and produces the same output under a new id", async () => {
    const original = Workflow.create({ name: "original" })
      .then(fn("up", (s: string) => s.toUpperCase()))
      .commit();
    const clone = cloneWorkflow(original, { id: "cloned" });

    const a = await original.run("hi");
    const b = await clone.run("hi");
    expect(a.output).toBe("HI");
    expect(b.output).toBe("HI");
    expect(a.name).toBe("original");
    expect(b.name).toBe("cloned"); // distinct identity
  });

  it("the clone is independent — running one does not affect the other", async () => {
    const original = Workflow.create({ name: "orig2" })
      .then(fn("s", (i: { n: number }) => ({ n: i.n + 1 })))
      .commit();
    const clone = cloneWorkflow(original, { id: "clone2" });
    const [a, b] = await Promise.all([original.run({ n: 1 }), clone.run({ n: 10 })]);
    expect(a.output).toEqual({ n: 2 });
    expect(b.output).toEqual({ n: 11 });
  });

  it("the clone is a structurally distinct instance (options + steps not aliased)", () => {
    const original = Workflow.create({ name: "orig3" })
      .then(fn("s", (i: unknown) => i))
      .commit();
    const clone = cloneWorkflow(original, { id: "clone3" });

    // distinct instances with distinct backing arrays/objects — a clone that
    // aliased __steps or __options would share mutable state with the original.
    expect(clone).not.toBe(original);
    expect(clone.__steps).not.toBe(original.__steps);
    expect(clone.__options).not.toBe(original.__options);
    // clone carries the SAME committed steps (opaque copy), not the same array.
    expect(clone.__steps).toEqual(original.__steps);
    // identity fields diverge so single-flight locks + observability don't collide.
    expect(clone.__options.name).toBe("clone3");
    expect(clone.__options.workflowId).not.toBe(original.__options.workflowId);
  });
});
