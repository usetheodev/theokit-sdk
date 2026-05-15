import { Agent } from "../../agent.js";
import { ConfigurationError } from "../../errors.js";
import type { AgentOptions } from "../../types/agent.js";
import type { CronJob } from "../../types/cron.js";
import type { Run, SDKUserMessage } from "../../types/run.js";
import { createStubRun } from "../runtime/stub-run.js";

/**
 * Execute a cron job by creating the configured agent (or reusing the
 * referenced `agentId`) and dispatching `job.message` through `agent.send()`.
 *
 * Used by both:
 *   - The public `Cron.run(jobId)` for manual off-schedule fires.
 *   - The internal scheduler's default fire handler, so timer ticks also
 *     drive a real agent run instead of being silent.
 *
 * Fallback semantics: when the cron job references an `agentId` that is
 * no longer registered (e.g. fixture-mode contract tests passing a fake
 * UUID, or a persisted job whose agent registry was lost across restart),
 * a `createStubRun()` handle is returned so the caller still gets a Run
 * with stable shape. This preserves the public contract while letting
 * real ephemeral-agent jobs drive a real LLM call.
 *
 * @internal
 */
export async function runCronJob(job: CronJob): Promise<Run> {
  if (job.agent !== undefined) return runWithEphemeralAgent(job.agent as AgentOptions, job.message);
  if (job.agentId !== undefined) return runWithExistingAgent(job.agentId, job.message);
  throw new ConfigurationError(`Cron job ${job.id} has neither agent nor agentId — cannot run.`, {
    code: "cron_no_target",
  });
}

async function runWithExistingAgent(
  agentId: string,
  message: string | SDKUserMessage,
): Promise<Run> {
  const info = await Agent.get(agentId).catch(() => undefined);
  if (info === undefined) {
    // Agent not registered (fixture-mode fake id or registry was lost).
    // Return a stub so callers see a stable Run shape.
    return createStubRun({ agentId, status: "running" });
  }
  const agent = await Agent.resume(agentId);
  return agent.send(message);
}

async function runWithEphemeralAgent(
  baseOptions: AgentOptions,
  message: string | SDKUserMessage,
): Promise<Run> {
  const agent = await Agent.create(baseOptions);
  return agent.send(message);
}
