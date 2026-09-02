import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fn, Workflow } from "../../src/workflow.js";

/**
 * SE29 — workflow shared state. `StepContext.state` / `setState`, typed by
 * `WorkflowOptions.stateSchema`, seeded by `initialState`, persisted across
 * suspend/resume. setState validates (typed WorkflowStateError → run fails).
 */

describe("SE29 — workflow state", () => {
  it("step 1 sets state; step 2 reads the updated value", async () => {
    const wf = Workflow.create({
      name: "counter",
      stateSchema: z.object({ count: z.number() }),
      initialState: { count: 0 },
    })
      .then(
        fn("inc", (_i: unknown, ctx) => {
          const s = ctx.state as { count: number };
          ctx.setState({ count: s.count + 1 });
          return _i;
        }),
      )
      .then(
        fn("read", (_i: unknown, ctx) => {
          return { seen: (ctx.state as { count: number }).count };
        }),
      )
      .commit();

    const run = await wf.run({});
    expect(run.status).toBe("completed");
    expect(run.output).toEqual({ seen: 1 });
  });

  it("initialState is visible to step 1", async () => {
    const wf = Workflow.create({ name: "seed", initialState: { hi: "there" } })
      .then(fn("read", (_i: unknown, ctx) => ctx.state))
      .commit();
    const run = await wf.run({});
    expect(run.output).toEqual({ hi: "there" });
  });

  it("setState with an invalid shape fails the run (typed WorkflowStateError)", async () => {
    const wf = Workflow.create({
      name: "guard",
      stateSchema: z.object({ count: z.number() }),
      initialState: { count: 0 },
    })
      .then(
        fn("bad", (_i: unknown, ctx) => {
          ctx.setState({ count: "not-a-number" }); // schema mismatch → throws
          return _i;
        }),
      )
      .commit();

    const run = await wf.run({});
    expect(run.status).toBe("failed");
    expect(run.error?.name).toBe("WorkflowStateError");
    expect(run.error?.message).toContain("count:");
  });

  it("an invalid initialState fails fast before any step (typed error)", async () => {
    const wf = Workflow.create({
      name: "bad-init",
      stateSchema: z.object({ count: z.number() }),
      initialState: { count: "nope" } as unknown as { count: number },
    })
      .then(fn("s1", (i: unknown) => i))
      .commit();
    const run = await wf.run({});
    expect(run.status).toBe("failed");
    expect(run.error?.name).toBe("WorkflowStateError");
    expect(run.stepResults).toHaveLength(0);
  });

  it("state survives a suspend → resume round-trip", async () => {
    const wf = Workflow.create({
      name: "susp-state",
      persistence: { backend: "memory" },
      stateSchema: z.object({ n: z.number() }),
      initialState: { n: 0 },
    })
      .then(
        fn("set", (_i: unknown, ctx) => {
          ctx.setState({ n: 42 });
          return _i;
        }),
      )
      .then(fn("pause", async (_i: unknown, ctx) => ctx.suspend({ ask: "more" })))
      .then(fn("read", (_i: unknown, ctx) => ({ recovered: (ctx.state as { n: number }).n }))) // after resume
      .commit();

    const first = await wf.run({});
    expect(first.status).toBe("suspended");

    const resumed = await Workflow.resume<{ recovered: number }>({
      runId: first.id,
      workflow: wf,
      payload: {},
    });
    expect(resumed.status).toBe("completed");
    expect(resumed.output).toEqual({ recovered: 42 }); // state survived suspend/resume
  });

  it("setState called twice in a step — the last write wins for later steps", async () => {
    const wf = Workflow.create({ name: "twice", initialState: { n: 0 } })
      .then(
        fn("multi", (_i: unknown, ctx) => {
          ctx.setState({ n: 1 });
          ctx.setState({ n: 2 }); // overwrites
          return _i;
        }),
      )
      .then(fn("read", (_i: unknown, ctx) => ctx.state))
      .commit();
    const run = await wf.run({});
    expect(run.output).toEqual({ n: 2 });
  });

  it("a non-JSON-serializable state fails the suspend-save with a typed error", async () => {
    const wf = Workflow.create({ name: "unserializable", persistence: { backend: "memory" } })
      .then(
        fn("set", (_i: unknown, ctx) => {
          ctx.setState({ big: 1n }); // BigInt → not JSON-serializable
          return _i;
        }),
      )
      .then(fn("pause", async (_i: unknown, ctx) => ctx.suspend()))
      .commit();
    const run = await wf.run({});
    // Snapshot save fails at suspend (state included) → status failed, typed error.
    expect(run.status).toBe("failed");
    expect(run.error?.name).toBe("WorkflowNotSerializableError");
  });

  it("no stateSchema/initialState ⇒ state is undefined, setState works unvalidated (back-compat)", async () => {
    const wf = Workflow.create({ name: "no-state" })
      .then(
        fn("s1", (_i: unknown, ctx) => {
          expect(ctx.state).toBeUndefined();
          ctx.setState({ any: "value" }); // no schema → no validation
          return _i;
        }),
      )
      .then(fn("s2", (_i: unknown, ctx) => ctx.state))
      .commit();
    const run = await wf.run({});
    expect(run.status).toBe("completed");
    expect(run.output).toEqual({ any: "value" });
  });
});
