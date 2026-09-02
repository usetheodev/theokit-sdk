/**
 * EventedWorkflowExecutor — opt-in evented variant with cron scheduling,
 * suspend/resume, and AbortSignal propagation (T11.2, ADR D451).
 *
 * Does NOT modify the base WorkflowExecutor (SRP). Consumers opt in via
 * `workflow.evented({ schedule? })`.
 *
 * EC-3: implements [Symbol.dispose]() to stop cron timer on GC/dispose.
 *
 * @internal
 */

import { randomUUID } from "node:crypto";
import type { Step, StepContext } from "../../types/workflow.js";
import { WorkflowScheduler } from "./scheduler.js";

const noop = () => {};
const noopLog: StepContext["log"] = { debug: noop, info: noop, warn: noop };

/**
 * Build a StepContext for step iteration — shared between run() and resume().
 * @internal
 */
interface StepContextInputs {
  readonly runId: string;
  readonly stepIndex: number;
  readonly currentRef: { value: unknown };
  readonly stateRef: { value: unknown };
  readonly suspended: Map<string, SuspendedState>;
  readonly signal: AbortSignal;
}

function buildStepContext({
  runId,
  stepIndex,
  currentRef,
  stateRef,
  suspended,
  signal,
}: StepContextInputs): StepContext {
  return {
    runId,
    signal,
    log: noopLog,
    suspend: (payload?: unknown): Promise<never> => {
      const name = typeof payload === "string" ? payload : `step-${stepIndex}`;
      suspended.set(runId, {
        runId,
        stepIndex: stepIndex + 1,
        suspendName: name,
        input: currentRef.value,
      });
      throw new SuspendSignal(name);
    },
    get state(): unknown {
      return stateRef.value;
    },
    setState: (next: unknown): void => {
      stateRef.value = next;
    },
  };
}

/**
 * Handle step execution errors — shared between run() and resume().
 * Returns a result if the error was handled, or undefined to re-throw.
 * @internal
 */
function handleStepError(err: unknown, runId: string): EventedWorkflowRunResult | undefined {
  if (err instanceof SuspendSignal) {
    return { runId, status: "suspended", suspendedAt: err.name };
  }
  return {
    runId,
    status: "error",
    error: err instanceof Error ? err : new Error(String(err)),
  };
}

export interface EventedWorkflowRunResult {
  runId: string;
  status: "completed" | "suspended" | "error";
  output?: unknown;
  suspendedAt?: string;
  error?: Error;
}

export interface EventedWorkflowRunOptions {
  signal?: AbortSignal;
}

export interface EventedWorkflowExecutorOptions {
  name: string;
  steps: Step[];
  schedule?: string;
}

interface SuspendedState {
  runId: string;
  stepIndex: number;
  suspendName: string;
  input: unknown;
}

export class EventedWorkflowExecutor {
  readonly name: string;
  private readonly _steps: Step[];
  private readonly _scheduler: WorkflowScheduler | null;
  private readonly _suspended = new Map<string, SuspendedState>();
  private _disposed = false;

  constructor(opts: EventedWorkflowExecutorOptions) {
    this.name = opts.name;
    this._steps = opts.steps;
    if (opts.schedule) {
      this._scheduler = new WorkflowScheduler({
        schedule: opts.schedule,
        handler: async () => {
          await this.run({});
        },
      });
      this._scheduler.start();
    } else {
      this._scheduler = null;
    }
  }

  get isScheduled(): boolean {
    return this._scheduler?.isRunning ?? false;
  }

  async run(input: unknown, opts?: EventedWorkflowRunOptions): Promise<EventedWorkflowRunResult> {
    const runId = randomUUID();
    const signal = opts?.signal ?? new AbortController().signal;

    return this._executeSteps({
      runId,
      input,
      startIndex: 0,
      signal,
      abortCheckSignal: opts?.signal,
    });
  }

  // SE29 note: this alternate executor does NOT persist `StepContext.state`
  // across suspend/resume (a fresh state ref is created per run). Use the main
  // `Workflow.resume()` for state persistence.
  async resume(runId: string, resumeData: unknown): Promise<EventedWorkflowRunResult> {
    const state = this._suspended.get(runId);
    if (!state) {
      return {
        runId,
        status: "error",
        error: new Error(`No suspended workflow with runId: ${runId}`),
      };
    }
    this._suspended.delete(runId);

    return this._executeSteps({
      runId,
      input: resumeData,
      startIndex: state.stepIndex,
      signal: new AbortController().signal,
    });
  }

  /** Shared step iteration — used by both run() and resume(). */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: step iteration with suspend/resume + error handling is inherently branchy
  private async _executeSteps({
    runId,
    input,
    startIndex,
    signal,
    abortCheckSignal,
  }: {
    readonly runId: string;
    readonly input: unknown;
    readonly startIndex: number;
    readonly signal: AbortSignal;
    readonly abortCheckSignal?: AbortSignal | undefined;
  }): Promise<EventedWorkflowRunResult> {
    const currentRef = { value: input };
    // SE29 — shared state ref (this alternate executor wires no `stateSchema`,
    // so `setState` is unvalidated here; the main executor validates).
    const stateRef: { value: unknown } = { value: undefined };

    for (let i = startIndex; i < this._steps.length; i++) {
      if (abortCheckSignal?.aborted) {
        return { runId, status: "error", error: new Error("aborted") };
      }

      const step = this._steps[i];
      if (!step || step.kind !== "fn") continue;

      const ctx = buildStepContext({
        runId,
        stepIndex: i,
        currentRef,
        stateRef,
        suspended: this._suspended,
        signal,
      });

      try {
        currentRef.value = await step.fn(currentRef.value, ctx);
      } catch (err) {
        const result = handleStepError(err, runId);
        if (result !== undefined) return result;
      }
    }

    return { runId, status: "completed", output: currentRef.value };
  }

  dispose(): void {
    if (this._disposed) return;
    this._scheduler?.dispose();
    this._suspended.clear();
    this._disposed = true;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

class SuspendSignal extends Error {
  constructor(name: string) {
    super(`Workflow suspended at: ${name}`);
    this.name = name;
  }
}
