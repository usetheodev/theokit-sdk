/**
 * Workflow executor (ADRs D230-D248).
 *
 * Walks `steps[]` sequentially, dispatching to per-kind handlers. Handles
 * suspend (sentinel pattern; D236), single-flight (D242), abort signal
 * boundaries (D245), and snapshot persistence opt-in (D235).
 *
 * @internal
 */

import {
  type Step,
  type StepContext,
  type StepResult,
  type WorkflowOptions,
  type WorkflowResumeOptions,
  WorkflowResumeStepNotFoundError,
  type WorkflowRun,
  type WorkflowRunOptions,
  type WorkflowSnapshot,
  WorkflowSnapshotNotFoundError,
} from "../../types/workflow.js";
import { combineSignals, makeStepContext, WorkflowSuspendedSentinel } from "./ctx.js";
import { errToShape } from "./error-shape.js";
import { mintRunId } from "./run-id.js";
import { acquireSingleFlight } from "./single-flight.js";
import { getSnapshotStoreFor } from "./snapshot-store.js";
import { runAgentStep } from "./step-agent.js";
import { runBranchStep } from "./step-branch.js";
import { runDowhileStep } from "./step-dowhile.js";
import { runFnStep } from "./step-fn.js";
import { runForeachStep } from "./step-foreach.js";
import { runParallelStep } from "./step-parallel.js";
import { runSleepStep } from "./step-sleep.js";
import { startWorkflowRunSpan, startWorkflowStepSpan } from "./telemetry.js";

export async function executeWorkflow<TInput, TOutput>(
  options: WorkflowOptions,
  steps: ReadonlyArray<Step>,
  input: TInput,
  runOpts?: WorkflowRunOptions,
): Promise<WorkflowRun<TOutput>> {
  const runId = runOpts?.runId ?? mintRunId();
  const workflowId = options.workflowId ?? `wf-anon`;
  const flight = acquireSingleFlight(workflowId, runId, options.name);
  const startedAt = Date.now();
  const signal = combineSignals(runOpts?.signal, flight.signal);
  const runSpan = startWorkflowRunSpan({ workflowName: options.name, runId });

  // EC-1 absorbed: fail fast if signal already aborted at entry.
  if (signal.aborted) {
    flight.release();
    runSpan.setAttribute("workflow.status", "cancelled");
    runSpan.end();
    return assembleRun<TOutput>({
      runId,
      name: options.name,
      status: "cancelled",
      stepResults: [],
      startedAt,
      error: { name: "AbortError", message: String(signal.reason ?? "Aborted") },
    });
  }

  const ctx: StepContext = makeStepContext(runId, signal);
  const stepResults: StepResult[] = [];
  let acc: unknown = input;

  try {
    for (const step of steps) {
      if (signal.aborted) {
        return assembleRun<TOutput>({
          runId,
          name: options.name,
          status: "cancelled",
          stepResults,
          startedAt,
          error: { name: "AbortError", message: String(signal.reason ?? "Aborted") },
        });
      }
      const stepSpan = startWorkflowStepSpan({
        stepId: step.id,
        kind: step.kind,
        attempt: 1,
      });
      let result: StepResult;
      try {
        result = await dispatchStep(step, acc, ctx, options, stepResults);
      } catch (err) {
        if (err instanceof WorkflowSuspendedSentinel) {
          // Persist snapshot + return suspended (EC-4 absorbed inside saveSnapshot).
          try {
            await saveSnapshot({
              runId,
              workflowName: options.name,
              currentStepId: step.id,
              suspendedPayload: err.payload,
              stepResults,
              accumulatedInput: acc,
              options,
            });
          } catch (snapErr) {
            stepSpan.setAttribute("step.status", "failed");
            stepSpan.end();
            return assembleRun<TOutput>({
              runId,
              name: options.name,
              status: "failed",
              stepResults,
              startedAt,
              error: errToShape(snapErr),
            });
          }
          stepSpan.setAttribute("step.status", "suspended");
          stepSpan.end();
          return assembleRun<TOutput>({
            runId,
            name: options.name,
            status: "suspended",
            stepResults: [
              ...stepResults,
              {
                stepId: step.id,
                kind: step.kind,
                status: "suspended",
                attempts: 1,
                durationMs: 0,
                output: undefined,
              },
            ],
            startedAt,
          });
        }
        // Other throw — wrap as failed step.
        result = {
          stepId: step.id,
          kind: step.kind,
          status: "failed",
          attempts: 1,
          durationMs: 0,
          error: errToShape(err),
        };
      }
      stepSpan.setAttribute("step.status", result.status);
      stepSpan.setAttribute("step.attempts", result.attempts);
      stepSpan.end();
      stepResults.push(result);
      if (result.status === "failed") {
        return assembleRun<TOutput>({
          runId,
          name: options.name,
          status: "failed",
          stepResults,
          startedAt,
          error: result.error,
        });
      }
      acc = result.output;
    }
    return assembleRun<TOutput>({
      runId,
      name: options.name,
      status: "completed",
      output: acc as TOutput,
      stepResults,
      startedAt,
    });
  } finally {
    runSpan.end();
    flight.release();
  }
}

/**
 * Dispatch single step to the right handler. Exhaustive over `step.kind`.
 */
export async function dispatchStep(
  step: Step,
  input: unknown,
  ctx: StepContext,
  options: WorkflowOptions,
  prevStepResults: ReadonlyArray<StepResult>,
): Promise<StepResult> {
  switch (step.kind) {
    case "fn":
      return runFnStep(step, input, ctx);
    case "agent":
      return runAgentStep(step, input, ctx);
    case "parallel":
      return runParallelStep(step, input, ctx, options, prevStepResults, dispatchStep);
    case "branch":
      return runBranchStep(step, input, ctx, options, prevStepResults, dispatchStep);
    case "foreach":
      return runForeachStep(step, input, ctx, options, prevStepResults, dispatchStep);
    case "dowhile":
      return runDowhileStep(step, input, ctx, options, prevStepResults, dispatchStep);
    case "sleep":
      return runSleepStep(step, input, ctx);
    case "suspend":
      // Standalone suspend: throw sentinel so executor catches.
      throw new WorkflowSuspendedSentinel(undefined);
    default: {
      const _exhaustive: never = step;
      throw new Error(`Unknown step kind: ${(_exhaustive as Step).kind}`);
    }
  }
}

interface AssembleParams<TO> {
  runId: string;
  name: string;
  status: WorkflowRun["status"];
  stepResults: ReadonlyArray<StepResult>;
  startedAt: number;
  output?: TO;
  error?: { name: string; message: string };
}

function assembleRun<TO>(params: AssembleParams<TO>): WorkflowRun<TO> {
  const endedAt = Date.now();
  return {
    id: params.runId,
    name: params.name,
    status: params.status,
    startedAt: params.startedAt,
    endedAt,
    stepResults: params.stepResults,
    ...(params.output !== undefined ? { output: params.output } : {}),
    ...(params.error !== undefined ? { error: params.error } : {}),
  };
}

interface SnapshotParams {
  runId: string;
  workflowName: string;
  currentStepId: string;
  suspendedPayload?: unknown;
  stepResults: ReadonlyArray<StepResult>;
  accumulatedInput: unknown;
  options: WorkflowOptions;
}

async function saveSnapshot(p: SnapshotParams): Promise<void> {
  const snapshot: WorkflowSnapshot = {
    _schemaVersion: 1,
    runId: p.runId,
    workflowName: p.workflowName,
    currentStepId: p.currentStepId,
    suspendedPayload: p.suspendedPayload,
    stepResults: p.stepResults,
    accumulatedInput: p.accumulatedInput,
    suspendedAt: Date.now(),
  };
  const store = getSnapshotStoreFor(p.options);
  await store.save(snapshot);
}

/* ─── Resume ─── */

export async function resumeWorkflow<TO>(opts: WorkflowResumeOptions): Promise<WorkflowRun<TO>> {
  // We need access to the workflow's internal options/steps. The public
  // resume API hands us a `workflow` reference exposing `.run` only — for
  // v1 we accept the user re-running the same workflow with the snapshot's
  // accumulated input + payload merged. Full resume-from-step support
  // would require exposing `__steps` and `__options`; v1 ships a simpler
  // "re-run from input" semantics gated by snapshot lookup.
  const wfInternal = opts.workflow as {
    __options?: WorkflowOptions;
    __steps?: ReadonlyArray<Step>;
    run: (input: unknown, runOpts?: WorkflowRunOptions) => Promise<WorkflowRun<TO>>;
  };
  const options = wfInternal.__options;
  const steps = wfInternal.__steps;
  if (options === undefined || steps === undefined) {
    throw new Error("Workflow.resume requires an instance from Workflow.create().commit()");
  }
  const store = getSnapshotStoreFor(options);
  const snapshot = await store.load(opts.runId);
  if (snapshot === undefined) {
    throw new WorkflowSnapshotNotFoundError(opts.runId);
  }
  // EC-8: verify the currentStepId exists in the supplied workflow.
  const stepIdx = steps.findIndex((s) => s.id === snapshot.currentStepId);
  if (stepIdx < 0) {
    throw new WorkflowResumeStepNotFoundError(snapshot.currentStepId, snapshot.workflowName);
  }

  // Validate payload if the suspend step declared a schema.
  const suspendStep = steps[stepIdx];
  if (
    suspendStep !== undefined &&
    suspendStep.kind === "suspend" &&
    suspendStep.payloadSchema !== undefined
  ) {
    suspendStep.payloadSchema.parse(opts.payload);
  }

  // For v1: continue from stepIdx + 1 with `payload` (if any) as the new
  // accumulated input. This is intentionally simpler than full state
  // restoration; the snapshot's `accumulatedInput` is preserved for
  // observability but the resume input is determined by the caller's
  // payload (or the snapshot's accumulator if payload is undefined).
  const resumeInput = opts.payload !== undefined ? opts.payload : snapshot.accumulatedInput;
  const remainingSteps = steps.slice(stepIdx + 1);

  // Drop snapshot once we begin (single-shot semantics).
  await store.delete(opts.runId);

  return executeWorkflow<unknown, TO>(options, remainingSteps, resumeInput, {
    signal: opts.signal,
    runId: opts.runId,
  });
}
