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
import type { Step } from "../../types/workflow.js";
import { WorkflowScheduler } from "./scheduler.js";

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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: step iteration with suspend/abort/error branches is inherent to workflow execution
  async run(input: unknown, opts?: EventedWorkflowRunOptions): Promise<EventedWorkflowRunResult> {
    const runId = randomUUID();
    let current: unknown = input;

    for (let i = 0; i < this._steps.length; i++) {
      if (opts?.signal?.aborted) {
        return { runId, status: "error", error: new Error("aborted") };
      }

      const step = this._steps[i];
      if (step.kind !== "fn") continue;

      let _suspended = false;
      const ctx = {
        signal: opts?.signal ?? new AbortController().signal,
        suspend: (name: string): never => {
          _suspended = true;
          this._suspended.set(runId, {
            runId,
            stepIndex: i + 1,
            suspendName: name,
            input: current,
          });
          throw new SuspendSignal(name);
        },
      };

      try {
        current = await (
          step as { handler: (input: unknown, ctx: unknown) => Promise<unknown> }
        ).handler(current, ctx);
      } catch (err) {
        if (err instanceof SuspendSignal) {
          return { runId, status: "suspended", suspendedAt: err.name };
        }
        return {
          runId,
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }

    return { runId, status: "completed", output: current };
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: resume mirrors run() step iteration with suspend/error branches
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

    let current: unknown = resumeData;
    for (let i = state.stepIndex; i < this._steps.length; i++) {
      const step = this._steps[i];
      if (step.kind !== "fn") continue;
      try {
        current = await (
          step as { handler: (input: unknown, ctx: unknown) => Promise<unknown> }
        ).handler(current, {
          signal: new AbortController().signal,
          suspend: (name: string): never => {
            this._suspended.set(runId, {
              runId,
              stepIndex: i + 1,
              suspendName: name,
              input: current,
            });
            throw new SuspendSignal(name);
          },
        });
      } catch (err) {
        if (err instanceof SuspendSignal) {
          return { runId, status: "suspended", suspendedAt: err.name };
        }
        return {
          runId,
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }

    return { runId, status: "completed", output: current };
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
