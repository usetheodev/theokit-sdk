/**
 * Tests for `Workflow.create` + `WorkflowBuilder` public surface.
 * Covers commit, validation, helper factories, EC-3/5/9.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  agentStep,
  fn,
  Workflow,
  WorkflowDuplicateStepIdError,
  __resetSnapshotStoresForTests,
} from "../../src/workflow.js";

describe("Workflow.create", () => {
  it("validates options via Zod (name required)", () => {
    expect(() => Workflow.create({ name: "" } as never)).toThrow();
    expect(() => Workflow.create({ name: "demo" })).not.toThrow();
  });

  it("EC-3 — retry maxAttempts must be int in [1, 20]", () => {
    expect(() => fn("step1", async () => 1, { retry: { maxAttempts: 0 } })).toThrow();
    expect(() => fn("step1", async () => 1, { retry: { maxAttempts: 21 } })).toThrow();
    expect(() => fn("step1", async () => 1, { retry: { maxAttempts: 3.5 } })).toThrow();
    expect(() => fn("step1", async () => 1, { retry: { maxAttempts: 3 } })).not.toThrow();
  });

  it("EC-9 — builder.commit() called twice throws", () => {
    const b = Workflow.create({ name: "demo" });
    b.then(fn("step1", async () => 1));
    b.commit();
    expect(() => b.commit()).toThrow(/already committed/i);
  });

  it("EC-5 — commit mints a unique workflowId per Workflow instance", async () => {
    const wf1 = Workflow.create({ name: "same-name" }).then(fn("a", async () => 1)).commit();
    const wf2 = Workflow.create({ name: "same-name" }).then(fn("a", async () => 1)).commit();
    // Both should be runnable concurrently without single-flight collision.
    const [r1, r2] = await Promise.all([wf1.run(undefined), wf2.run(undefined)]);
    expect(r1.status).toBe("completed");
    expect(r2.status).toBe("completed");
    __resetSnapshotStoresForTests();
  });

  it("throws on duplicate step id at commit time", () => {
    const b = Workflow.create({ name: "demo" })
      .then(fn("step1", async () => 1))
      .then(fn("step1", async () => 2)); // duplicate
    expect(() => b.commit()).toThrow(WorkflowDuplicateStepIdError);
  });

  it("rejects invalid step id grammar (special chars, empty)", () => {
    expect(() => fn("step.1", async () => 1)).toThrow();
    expect(() => fn("step 1", async () => 1)).toThrow();
    expect(() => fn("", async () => 1)).toThrow();
    expect(() => fn("step-ok_123", async () => 1)).not.toThrow();
    // Note: sanitizeIdentifier lowercases uppercase input, so "Step1" → "step1" is accepted.
  });

  it("agentStep helper accepts string + function templates", () => {
    const fakeAgent = {
      agentId: "agent-fake",
      send: async () => ({ wait: async () => ({ status: "finished" as const, result: "ok" }) }),
    } as never;
    expect(() => agentStep("classify", fakeAgent, "static prompt")).not.toThrow();
    expect(() => agentStep("classify2", fakeAgent, (i) => `dynamic ${JSON.stringify(i)}`)).not.toThrow();
  });

  it("supports Zod input/output schemas on fn step", () => {
    const step = fn("validate", async (input: { id: string }) => ({ valid: true, id: input.id }), {
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ valid: z.boolean(), id: z.string() }),
    });
    expect(step.kind).toBe("fn");
    expect(step.inputSchema).toBeDefined();
    expect(step.outputSchema).toBeDefined();
  });
});
