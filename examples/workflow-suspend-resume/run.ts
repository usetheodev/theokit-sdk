/**
 * Workflow suspend/resume — pause for a human, then continue.
 *
 * `ctx.suspend(payload)` inside a `fn` pauses the run (`status: "suspended"`) and returns a runId.
 * Later, `Workflow.resume({ runId, workflow, payload })` continues from the next step with the
 * approval payload. This is the human-in-the-loop seam. No LLM — deterministic.
 */
import { Workflow, fn } from "@theokit/sdk/workflow";

const approval = Workflow.create({ name: "approval" })
  .then(fn("draft", () => "draft text"))
  .then(
    fn("gate", async (input, ctx) => {
      await ctx.suspend({ awaiting: "human-approval", draft: input });
      return "unreached"; // the suspend sentinel terminates this step
    }),
  )
  .then(fn("publish", (payload) => `published: ${JSON.stringify(payload)}`))
  .commit();

// First run pauses at the gate.
const first = await approval.run(undefined);
console.log("First run status:", first.status);

// Later, after a human approves, resume from where it stopped.
const resumed = await Workflow.resume({
  runId: first.id,
  workflow: approval,
  payload: { approved: true, by: "manager" },
});
console.log("Resumed status:", resumed.status);
console.log("Output:", resumed.output);
