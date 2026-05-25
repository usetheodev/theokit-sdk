/**
 * Execute a `FnStep` — call the user-supplied function with `input` + `ctx`.
 * Wraps in `withRetry` if a retry policy is set (D237).
 *
 * Validates input/output via Zod when schemas are supplied. EC-4 / D229
 * pattern: empty/undefined input parses as `{}` only when schema is defined.
 *
 * @internal
 */

import type { FnStep, StepContext, StepResult } from "../../types/workflow.js";
import { WorkflowCompensateNotImplementedError } from "../../types/workflow.js";
import { WorkflowSuspendedSentinel } from "./ctx.js";
import { errToShape } from "./error-shape.js";
import { withRetry } from "./retry-policy.js";

export async function runFnStep(
  step: FnStep,
  input: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const startedAt = Date.now();
  // D238: saga engine not implemented in v1 — surface intent loudly.
  if (step.compensate !== undefined) {
    return {
      stepId: step.id,
      kind: "fn",
      status: "failed",
      attempts: 0,
      durationMs: Date.now() - startedAt,
      error: errToShape(new WorkflowCompensateNotImplementedError(step.id)),
    };
  }

  if (step.inputSchema !== undefined) {
    try {
      step.inputSchema.parse(input);
    } catch (err) {
      return {
        stepId: step.id,
        kind: "fn",
        status: "failed",
        attempts: 0,
        durationMs: Date.now() - startedAt,
        error: errToShape(err),
      };
    }
  }

  const exec = async (): Promise<unknown> => step.fn(input, ctx);
  try {
    const { value, attempts } =
      step.retry !== undefined
        ? await withRetry(exec, step.retry, ctx.signal)
        : { value: await exec(), attempts: 1 };

    if (step.outputSchema !== undefined) {
      try {
        step.outputSchema.parse(value);
      } catch (err) {
        return {
          stepId: step.id,
          kind: "fn",
          status: "failed",
          attempts,
          durationMs: Date.now() - startedAt,
          error: errToShape(err),
        };
      }
    }
    return {
      stepId: step.id,
      kind: "fn",
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
      kind: "fn",
      status: "failed",
      attempts: 1,
      durationMs: Date.now() - startedAt,
      error: errToShape(err),
    };
  }
}
