import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { WorkflowEvent } from "../../src/types/workflow.js";
import { fn, Workflow } from "../../src/workflow.js";

/**
 * SE28 — Workflow.stream(): step-level events during execution + a `result`
 * promise resolving to the same terminal WorkflowRun run() returns. Events fire
 * in execution order; run() stays authoritative + unchanged.
 */

async function drain(stream: AsyncIterable<WorkflowEvent>): Promise<WorkflowEvent[]> {
  const events: WorkflowEvent[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

describe("SE28 — Workflow.stream()", () => {
  it("emits step_started/step_completed per step in order, then workflow_completed", async () => {
    const wf = Workflow.create({ name: "two-step" })
      .then(fn("s1", (i: { n: number }) => ({ n: i.n + 1 })))
      .then(fn("s2", (i: { n: number }) => ({ n: i.n * 10 })))
      .commit();

    const stream = wf.stream({ n: 1 });
    const events = await drain(stream);
    const result = await stream.result;

    expect(events.map((e) => e.type)).toEqual([
      "step_started",
      "step_completed",
      "step_started",
      "step_completed",
      "workflow_completed",
    ]);
    expect(
      events.filter((e) => e.type === "step_started").map((e) => "stepId" in e && e.stepId),
    ).toEqual(["s1", "s2"]);
    // result matches run()'s terminal WorkflowRun.
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ n: 20 });
  });

  it("emits step_failed when a step throws; result is a failed run", async () => {
    const wf = Workflow.create({ name: "boom" })
      .then(
        fn("bad", () => {
          throw new Error("kaboom");
        }),
      )
      .commit();

    const stream = wf.stream({});
    const events = await drain(stream);
    const result = await stream.result;

    const failed = events.find((e) => e.type === "step_failed");
    expect(failed).toBeDefined();
    if (failed?.type === "step_failed") {
      expect(failed.stepId).toBe("bad");
      expect(failed.error.message).toContain("kaboom");
    }
    expect(events.some((e) => e.type === "workflow_completed")).toBe(false);
    expect(result.status).toBe("failed");
  });

  it("emits workflow_suspended on a suspend, then the stream ends (resumable)", async () => {
    const wf = Workflow.create({ name: "susp", persistence: { backend: "memory" } })
      .then(fn("s1", (i: unknown) => i))
      .then(fn("s2", async (_i: unknown, ctx) => ctx.suspend({ ask: "more" })))
      .commit();

    const stream = wf.stream({ start: true });
    const events = await drain(stream);
    const result = await stream.result;

    expect(events.map((e) => e.type)).toContain("workflow_suspended");
    expect(events.some((e) => e.type === "workflow_completed")).toBe(false);
    expect(result.status).toBe("suspended");
  });

  it("carries step output on step_completed events", async () => {
    const wf = Workflow.create({ name: "out" })
      .then(fn("up", (s: string) => s.toUpperCase()))
      .commit();
    const stream = wf.stream("hi");
    const events = await drain(stream);
    const completed = events.find((e) => e.type === "step_completed");
    expect(completed?.type === "step_completed" && completed.output).toBe("HI");
  });

  it("result resolves without draining the stream (no hang)", async () => {
    const wf = Workflow.create({ name: "no-drain" })
      .then(fn("s1", (i: unknown) => i))
      .commit();
    const stream = wf.stream({ ok: true });
    // Never iterate the events — just await result.
    const result = await stream.result;
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ ok: true });
  });

  it("breaking out of the for-await early terminates cleanly (return())", async () => {
    const wf = Workflow.create({ name: "early-break" })
      .then(fn("s1", (i: unknown) => i))
      .then(fn("s2", (i: unknown) => i))
      .commit();
    const stream = wf.stream({});
    const seen: string[] = [];
    for await (const e of stream) {
      seen.push(e.type);
      break; // early exit — return() closes the stream
    }
    expect(seen).toEqual(["step_started"]);
    // result still resolves.
    expect((await stream.result).status).toBe("completed");
  });

  it("a zero-step workflow emits only workflow_completed", async () => {
    const wf = Workflow.create({ name: "empty" }).commit();
    const stream = wf.stream({ x: 1 });
    const events = await drain(stream);
    expect(events.map((e) => e.type)).toEqual(["workflow_completed"]);
    expect((await stream.result).output).toEqual({ x: 1 }); // input passes through
  });

  it("an SE27 input-schema failure emits NO step events (fails before step 1)", async () => {
    const wf = Workflow.create({ name: "in-fail", inputSchema: z.object({ n: z.number() }) })
      .then(fn("s1", (i: unknown) => i))
      .commit();
    const stream = wf.stream({ n: "bad" } as unknown as { n: number });
    const events = await drain(stream);
    expect(events).toEqual([]); // no events — validation failed before runStepsLoop
    expect((await stream.result).error?.name).toBe("WorkflowInputError");
  });

  it("back-compat: run() is unchanged (no events, authoritative result)", async () => {
    const wf = Workflow.create({
      name: "compat",
      inputSchema: z.object({ n: z.number() }),
      outputSchema: z.object({ doubled: z.number() }),
    })
      .then(fn("double", (i: { n: number }) => ({ doubled: i.n * 2 })))
      .commit();
    const run = await wf.run({ n: 21 });
    expect(run.status).toBe("completed");
    expect(run.output).toEqual({ doubled: 42 });
  });
});
