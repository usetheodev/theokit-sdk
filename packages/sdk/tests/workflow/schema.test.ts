import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { fn, Workflow } from "../../src/workflow.js";

/**
 * SE27 — whole-workflow inputSchema / outputSchema validation. Input is validated
 * BEFORE step 1 (fail-fast, typed WorkflowInputError, no step runs); the final
 * output is validated on the completed path (typed WorkflowOutputError). Both
 * surface as status: "failed" — run() never throws.
 */

describe("SE27 — workflow-level schema validation", () => {
  it("a valid input runs to completion", async () => {
    const wf = Workflow.create({
      name: "ok",
      inputSchema: z.object({ n: z.number() }),
      outputSchema: z.object({ doubled: z.number() }),
    })
      .then(fn("double", (input: { n: number }) => ({ doubled: input.n * 2 })))
      .commit();

    const run = await wf.run({ n: 21 });
    expect(run.status).toBe("completed");
    expect(run.output).toEqual({ doubled: 42 });
  });

  it("an invalid input fails fast BEFORE any step runs (typed WorkflowInputError)", async () => {
    const step = vi.fn((input: { n: number }) => ({ doubled: input.n * 2 }));
    const wf = Workflow.create({
      name: "guard-in",
      inputSchema: z.object({ n: z.number() }),
    })
      .then(fn("double", step))
      .commit();

    // n is a string → schema mismatch.
    const run = await wf.run({ n: "not-a-number" } as unknown as { n: number });
    expect(run.status).toBe("failed");
    expect(run.error?.name).toBe("WorkflowInputError");
    expect(run.error?.message).toContain("n:");
    expect(run.stepResults).toHaveLength(0); // no step executed
    expect(step).not.toHaveBeenCalled();
  });

  it("an output-schema mismatch yields status failed (typed WorkflowOutputError)", async () => {
    const wf = Workflow.create({
      name: "guard-out",
      outputSchema: z.object({ doubled: z.number() }),
    })
      // returns the wrong shape ({ wrong } instead of { doubled }).
      .then(fn("bad", () => ({ wrong: 1 })))
      .commit();

    const run = await wf.run({});
    expect(run.status).toBe("failed");
    expect(run.error?.name).toBe("WorkflowOutputError");
    // the step itself succeeded — the failure is the whole-workflow output check.
    expect(run.stepResults.at(-1)?.status).toBe("completed");
  });

  it("no schemas ⇒ behavior unchanged (back-compat)", async () => {
    const wf = Workflow.create({ name: "no-schema" })
      .then(fn("id", (input: unknown) => input))
      .commit();
    const run = await wf.run({ anything: true });
    expect(run.status).toBe("completed");
    expect(run.output).toEqual({ anything: true });
  });

  it("output validation does NOT fire on a suspended run", async () => {
    const wf = Workflow.create({
      name: "susp-out",
      persistence: { backend: "memory" },
      // This would FAIL against the step output, but the run suspends before completion.
      outputSchema: z.object({ x: z.number() }),
    })
      .then(fn("s1", () => ({ wrong: 1 })))
      .then(fn("s2", async (_i: unknown, ctx) => ctx.suspend({ ask: "more" })))
      .commit();

    const run = await wf.run({});
    expect(run.status).toBe("suspended"); // NOT "failed" — output never validated
    expect(run.error).toBeUndefined();
  });

  it("an async-refinement schema fails the run (typed error), never throws out of run()", async () => {
    const wf = Workflow.create({
      name: "async-schema",
      inputSchema: z.string().refine(async () => true, "async"),
    })
      .then(fn("id", (s: string) => s))
      .commit();

    // Must resolve (not reject) — run() never throws.
    const run = await wf.run("hi");
    expect(run.status).toBe("failed");
    expect(run.error?.name).toBe("WorkflowInputError");
    expect(run.error?.message).toContain("async refinements");
  });

  it("only inputSchema set: validates input, leaves output untouched", async () => {
    const wf = Workflow.create({ name: "in-only", inputSchema: z.string() })
      .then(fn("up", (s: string) => s.toUpperCase()))
      .commit();
    expect((await wf.run("hi")).status).toBe("completed");
    expect((await wf.run(123 as unknown as string)).error?.name).toBe("WorkflowInputError");
  });
});
