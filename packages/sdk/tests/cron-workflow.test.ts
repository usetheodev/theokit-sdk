import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Cron } from "../src/cron.js";
import { fireCronJobAsTask } from "../src/internal/cron/fire-handler.js";
import { clearJobs } from "../src/internal/cron/store.js";
import { Task } from "../src/task.js";
import type { WorkflowRun } from "../src/types/workflow.js";
import { fn, Workflow } from "../src/workflow.js";

/**
 * SE35 (ADR 0014) — a `Cron` job may target a shipped `Workflow` instead of an
 * agent. The workflow INSTANCE is held in the (in-memory) job; a fire runs
 * `workflow.run(inputData)`. Deterministic — the workflow uses pure `fn` steps,
 * so no LLM is involved. Mutually exclusive with agent targets; `message` is
 * forbidden with a workflow.
 */

// A trivial committed workflow: doubles `inputData.n`. Pure fn step, no LLM.
function doubler() {
  return Workflow.create({ name: "doubler" })
    .then(fn("double", (i: { n: number }) => ({ n: i.n * 2 })))
    .commit();
}

beforeEach(() => clearJobs());
afterEach(() => clearJobs());

// The task registry runs `work` fire-and-forget; poll the handle until terminal.
async function waitForCronTaskResult(jobId: string): Promise<unknown> {
  for (let i = 0; i < 200; i++) {
    const handle = (await Task.list({ kind: "cron" })).find((t) =>
      t.id.startsWith(`cron-${jobId}-`),
    );
    if (handle !== undefined && ["finished", "error", "cancelled"].includes(handle.state)) {
      return handle.result;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`cron task for job ${jobId} did not reach a terminal state`);
}

describe("SE35 — Cron workflow target", () => {
  it("create({ workflow, inputData }) holds the workflow + inputData on the job (no agent target)", async () => {
    const wf = doubler();
    const job = await Cron.create({ cron: "@hourly", workflow: wf, inputData: { n: 21 } });
    expect(job.workflow).toBe(wf);
    expect(job.inputData).toEqual({ n: 21 });
    expect(job.agent).toBeUndefined();
    expect(job.agentId).toBeUndefined();
    expect(job.runtime).toBe("local");
  });

  it("Cron.run fires the workflow with inputData and returns the terminal WorkflowRun", async () => {
    const job = await Cron.create({ cron: "@hourly", workflow: doubler(), inputData: { n: 21 } });
    const result = (await Cron.run(job.id)) as WorkflowRun<{ n: number }>;
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ n: 42 });
  });

  // The XOR is a RUNTIME validation (the types keep the targets optional), so
  // these are type-valid calls that reject at runtime.
  it("rejects a workflow paired with an existing-agent target (mutually exclusive)", async () => {
    await expect(
      Cron.create({ cron: "@hourly", workflow: doubler(), agentId: "agent-x" }),
    ).rejects.toThrow(/mutually exclusive|exactly one/i);
  });

  it("rejects a workflow paired with an ephemeral-agent target (mutually exclusive)", async () => {
    await expect(
      Cron.create({
        cron: "@hourly",
        workflow: doubler(),
        agent: { apiKey: "k", model: { id: "openai/gpt-4o-mini" } },
      }),
    ).rejects.toThrow(/mutually exclusive|exactly one/i);
  });

  it("rejects a workflow paired with a chat message (workflow takes inputData, not a message)", async () => {
    await expect(
      Cron.create({ cron: "@hourly", workflow: doubler(), message: "hello" }),
    ).rejects.toThrow(/message/i);
  });

  it("rejects a job with no target (neither agent, agentId, nor workflow)", async () => {
    await expect(Cron.create({ cron: "@hourly" })).rejects.toThrow(/target|agent|workflow/i);
  });

  it("the fire handler records a WORKFLOW fire's terminal status without calling .wait()", async () => {
    // A workflow fire returns an already-terminal WorkflowRun. If the handler
    // wrongly called .wait() (as it does for an agent Run), this would throw.
    const job = await Cron.create({ cron: "@hourly", workflow: doubler(), inputData: { n: 10 } });
    await expect(fireCronJobAsTask(job)).resolves.toBeUndefined();
    // The Task-registry wrap recorded the workflow's terminal status.
    expect(await waitForCronTaskResult(job.id)).toMatchObject({ status: "completed" });
  });

  it("agent-target jobs are unchanged (message + agentId still works, no workflow field)", async () => {
    const job = await Cron.create({
      cron: "@hourly",
      message: "status check",
      agentId: "agent-00000000-0000-4000-8000-000000000001",
    });
    expect(job.workflow).toBeUndefined();
    expect(job.inputData).toBeUndefined();
    expect(job.agentId).toBe("agent-00000000-0000-4000-8000-000000000001");
    expect(job.message).toBe("status check");
  });
});
