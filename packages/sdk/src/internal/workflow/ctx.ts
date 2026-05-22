/**
 * Build the `StepContext` passed to every step.fn. The `suspend` method
 * throws a `WorkflowSuspendedSentinel` (defined here) that the executor
 * catches to persist a snapshot (D236).
 *
 * @internal
 */

import type { StepContext } from "../../types/workflow.js";

/** Sentinel thrown by `ctx.suspend()`; only the executor catches it. */
export class WorkflowSuspendedSentinel extends Error {
  override readonly name = "WorkflowSuspendedSentinel";
  constructor(public readonly payload?: unknown) {
    super("__workflow_suspended__");
  }
}

export function makeStepContext(runId: string, signal: AbortSignal): StepContext {
  return {
    runId,
    signal,
    log: {
      debug: (msg, attrs) => emit("debug", runId, msg, attrs),
      info: (msg, attrs) => emit("info", runId, msg, attrs),
      warn: (msg, attrs) => emit("warn", runId, msg, attrs),
    },
    suspend: async (payload?: unknown) => {
      throw new WorkflowSuspendedSentinel(payload);
    },
  };
}

function emit(
  level: "debug" | "info" | "warn",
  runId: string,
  msg: string,
  attrs?: Record<string, unknown>,
): void {
  const tag = `[workflow ${runId}]`;
  if (attrs !== undefined) {
    if (level === "warn") console.warn(tag, msg, attrs);
    else console.log(tag, msg, attrs);
  } else {
    if (level === "warn") console.warn(tag, msg);
    else console.log(tag, msg);
  }
}

/**
 * Combine the caller-supplied signal with the flight signal so abort on
 * either side cancels the workflow run.
 */
export function combineSignals(...signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal {
  const valid = signals.filter((s): s is AbortSignal => s !== undefined);
  if (valid.length === 0) return new AbortController().signal;
  if (valid.length === 1) return valid[0]!;
  const ctrl = new AbortController();
  for (const s of valid) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}
