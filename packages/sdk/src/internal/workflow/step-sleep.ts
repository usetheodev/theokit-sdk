/**
 * Execute a `SleepStep` — pause for `durationMs`. Aborts mid-sleep
 * when the signal fires (D245).
 *
 * @internal
 */

import type { SleepStep, StepContext, StepResult } from "../../types/workflow.js";
import { errToShape } from "./error-shape.js";
import { abortableSleep } from "./retry-policy.js";

export async function runSleepStep(
  step: SleepStep,
  input: unknown,
  ctx: StepContext,
): Promise<StepResult> {
  const startedAt = Date.now();
  try {
    await abortableSleep(step.durationMs, ctx.signal);
    return {
      stepId: step.id,
      kind: "sleep",
      status: "completed",
      attempts: 1,
      durationMs: Date.now() - startedAt,
      output: input, // sleep is a pass-through
    };
  } catch (err) {
    return {
      stepId: step.id,
      kind: "sleep",
      status: "failed",
      attempts: 1,
      durationMs: Date.now() - startedAt,
      error: errToShape(err),
    };
  }
}
