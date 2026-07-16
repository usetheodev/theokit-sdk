import { ConfigurationError, UnknownAgentError } from "../../errors.js";
import type { AgentOptions } from "../../types/agent.js";
import type { CronJob } from "../../types/cron.js";
import type { Run, SDKUserMessage } from "../../types/run.js";
import type { WorkflowRun } from "../../types/workflow.js";
import { getAgentFacade } from "../runtime/registry/agent-factory-registry.js";

/**
 * Execute a cron job. Dispatches to one of three targets:
 *   - `workflow` (SE35) → `workflow.run(inputData)` on the held instance (the
 *     instance carries its own `.run`, so this module never imports `workflow.ts`),
 *     returning the already-terminal {@link WorkflowRun}.
 *   - `agent` → an ephemeral agent per fire; `agent.send(message)` → {@link Run}.
 *   - `agentId` → reuse an existing agent; `agent.send(message)` → {@link Run}.
 *
 * Used by both `Cron.run(jobId)` (manual off-schedule fire) and the scheduler's
 * default fire handler. ADR 0014.
 *
 * @internal
 */
export async function runCronJob(job: CronJob): Promise<Run | WorkflowRun> {
  // `Workflow.run()` resolves only on a TERMINAL run (completed/failed/suspended/
  // cancelled — the executor never returns `status: "running"`), so the fire
  // handler treats the returned WorkflowRun as terminal (no `.wait()`).
  if (job.workflow !== undefined) return job.workflow.run(job.inputData);
  if (job.agent !== undefined) return runWithEphemeralAgent(job.agent, requireMessage(job));
  if (job.agentId !== undefined) return runWithExistingAgent(job.agentId, requireMessage(job));
  throw new ConfigurationError(
    `Cron job ${job.id} has no target (agent, agentId, or workflow) — cannot run.`,
    { code: "cron_no_target" },
  );
}

/**
 * Discriminate the {@link runCronJob} union: an agent `Run` is deferred (carries
 * `.wait()`/`.cancel()`); a {@link WorkflowRun} is already terminal (no `.wait()`).
 * @internal
 */
export function isAgentRun(outcome: Run | WorkflowRun): outcome is Run {
  return typeof (outcome as Run).wait === "function";
}

/** Agent targets require a message; fail-loud if one somehow reached a fire without it. */
function requireMessage(job: CronJob): string | SDKUserMessage {
  if (job.message === undefined) {
    throw new ConfigurationError(`Cron job ${job.id} is an agent target but has no message.`, {
      code: "cron_missing_message",
    });
  }
  return job.message;
}

async function runWithExistingAgent(
  agentId: string,
  message: string | SDKUserMessage,
): Promise<Run> {
  const info = await getAgentFacade()
    .get(agentId)
    .catch(() => undefined);
  if (info === undefined) {
    throw new UnknownAgentError(
      `Cron job references agentId "${agentId}" but no such agent is registered. The agent may have been disposed or the process restarted without persisting the agent registry.`,
      { code: "agent_not_registered" },
    );
  }
  const agent = await getAgentFacade().resume(agentId);
  return agent.send(message);
}

async function runWithEphemeralAgent(
  baseOptions: AgentOptions,
  message: string | SDKUserMessage,
): Promise<Run> {
  const agent = await getAgentFacade().create(baseOptions);
  return agent.send(message);
}
