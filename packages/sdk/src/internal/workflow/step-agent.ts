/**
 * Execute an `AgentStep` — render the prompt template, call `agent.send`,
 * wait for completion, return the result text as step output (ADR D244,
 * D245).
 *
 * Cloud guard: agents marked as `CloudAgent` throw `UnsupportedRunOperationError`
 * (workflows are local-only in v1).
 *
 * @internal
 */

import type { AgentStep, StepContext, StepResult } from "../../types/workflow.js";
import { UnsupportedRunOperationError } from "../../errors.js";
import { withRetry } from "./retry-policy.js";
import { errToShape } from "./error-shape.js";
import { WorkflowSuspendedSentinel } from "./ctx.js";

export async function runAgentStep(
  step: AgentStep,
  input: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const startedAt = Date.now();
  // D244: cloud guard — workflows are LocalAgent-only in v1.
  const agentId = step.agent.agentId;
  if (typeof agentId === "string" && agentId.startsWith("bc-")) {
    return {
      stepId: step.id,
      kind: "agent",
      status: "failed",
      attempts: 0,
      durationMs: Date.now() - startedAt,
      error: errToShape(
        new UnsupportedRunOperationError(
          "Workflow agent steps not supported on CloudAgent yet (D244)." +
            ` agent="${agentId}", step="${step.id}"`,
          "workflow",
        ),
      ),
    };
  }

  let prompt: string;
  try {
    prompt = typeof step.promptTemplate === "string"
      ? step.promptTemplate
      : step.promptTemplate(input);
  } catch (err) {
    return {
      stepId: step.id,
      kind: "agent",
      status: "failed",
      attempts: 0,
      durationMs: Date.now() - startedAt,
      error: errToShape(err),
    };
  }
  if (typeof prompt !== "string" || prompt.length === 0) {
    return {
      stepId: step.id,
      kind: "agent",
      status: "failed",
      attempts: 0,
      durationMs: Date.now() - startedAt,
      error: errToShape(new Error(`agentStep "${step.id}": rendered prompt must be a non-empty string`)),
    };
  }

  const exec = async (): Promise<string> => {
    const run = await step.agent.send(prompt);
    const result = await run.wait();
    if (result.status === "finished") {
      return result.result ?? "";
    }
    if (result.status === "error") {
      throw (result as { error?: Error }).error ?? new Error("agent.send errored");
    }
    throw new Error(`Unexpected agent status: ${result.status}`);
  };

  try {
    const { value, attempts } = step.retry !== undefined
      ? await withRetry(exec, step.retry, ctx.signal)
      : { value: await exec(), attempts: 1 };
    return {
      stepId: step.id,
      kind: "agent",
      status: "completed",
      attempts,
      durationMs: Date.now() - startedAt,
      output: value,
    };
  } catch (err) {
    // Re-throw suspend sentinel so the executor can persist a snapshot.
    if (err instanceof WorkflowSuspendedSentinel) throw err;
    return {
      stepId: step.id,
      kind: "agent",
      status: "failed",
      attempts: 1,
      durationMs: Date.now() - startedAt,
      error: errToShape(err),
    };
  }
}
