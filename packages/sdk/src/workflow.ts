/**
 * Public `Workflow` class — declarative multi-step orchestration over
 * `Agent.send`, `Handoff`, `Agent.batch` and friends (Adoption Roadmap #5;
 * ADRs D230-D248).
 *
 * Usage:
 *
 *   import { Agent, Workflow, fn, agentStep } from "@usetheo/sdk";
 *
 *   const classifier = await Agent.create({ ... });
 *   const wf = Workflow.create({ name: "demo" })
 *     .then(fn("validate", (input: { id: string }) => {
 *       if (!input.id) throw new Error("missing id");
 *       return input;
 *     }))
 *     .then(agentStep("classify", classifier, (i) => `Classify: ${JSON.stringify(i)}`))
 *     .commit();
 *
 *   const run = await wf.run({ id: "x" });
 *   console.log(run.status, run.output);
 *
 * @public
 */

import type { ZodType } from "zod";
import { z } from "zod";
import { PersistenceSchema } from "./internal/persistence/persistence-schema.js";
import { sanitizeIdentifier } from "./internal/security/path-guard.js";
import type { SDKAgent } from "./types/agent.js";
import type {
  AgentStep,
  BranchStep,
  DowhileStep,
  FnStep,
  ForeachStep,
  ParallelStep,
  RetryPolicy,
  SleepStep,
  Step,
  StepContext,
  SuspendStep,
  WorkflowOptions,
  WorkflowResumeOptions,
  WorkflowRun,
  WorkflowRunOptions,
} from "./types/workflow.js";
import { WorkflowDuplicateStepIdError } from "./types/workflow.js";

/* ─── Zod validation schemas ─── */

const RetryPolicySchema = z.object({
  // EC-3 absorbed: maxAttempts MUST be a finite int in [1, 20].
  maxAttempts: z
    .number()
    .int("retry.maxAttempts must be integer")
    .min(1, "retry.maxAttempts must be >= 1")
    .max(20, "retry.maxAttempts must be <= 20"),
  initialBackoffMs: z.number().int().min(0).optional(),
  backoffCoefficient: z.number().min(1).optional(),
  maximumBackoffMs: z.number().int().min(0).optional(),
  nonRetryableErrors: z.array(z.string()).optional(),
});

const WorkflowOptionsSchema = z.object({
  name: z.string().min(1).max(128),
  persistence: PersistenceSchema,
});

/* ─── Builder ─── */

export class WorkflowBuilder<TInput = unknown, TOutput = unknown> {
  private readonly _steps: Step[] = [];
  private _committed = false;

  /** @internal */
  constructor(private readonly options: WorkflowOptions) {}

  /** @internal — only the executor reads this. */
  get __steps(): ReadonlyArray<Step> {
    return this._steps;
  }

  // biome-ignore lint/suspicious/noThenProperty: D233 locks the a peer framework-style `.then(step)` builder DSL. The method is fluent, never awaited.
  then<TO = unknown>(step: Step): WorkflowBuilder<TInput, TO> {
    this.assertNotCommitted();
    validateStepId(step.id);
    this._steps.push(step);
    return this as unknown as WorkflowBuilder<TInput, TO>;
  }

  parallel(
    branches: ReadonlyArray<ReadonlyArray<Step>>,
    opts?: { id?: string; concurrency?: number; errorPolicy?: "fail-fast" | "collect" },
  ): WorkflowBuilder<TInput, unknown[]> {
    this.assertNotCommitted();
    const id = opts?.id ?? `parallel_${this._steps.length}`;
    validateStepId(id);
    for (const branch of branches) {
      for (const inner of branch) validateStepId(inner.id);
    }
    const step: ParallelStep = {
      kind: "parallel",
      id,
      branches,
      ...(opts?.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts?.errorPolicy !== undefined ? { errorPolicy: opts.errorPolicy } : {}),
    };
    this._steps.push(step);
    return this as unknown as WorkflowBuilder<TInput, unknown[]>;
  }

  branch(
    predicates: BranchStep["predicates"],
    opts?: { id?: string; fallback?: ReadonlyArray<Step> },
  ): WorkflowBuilder<TInput, unknown> {
    this.assertNotCommitted();
    const id = opts?.id ?? `branch_${this._steps.length}`;
    validateStepId(id);
    const step: BranchStep = {
      kind: "branch",
      id,
      predicates,
      ...(opts?.fallback !== undefined ? { fallback: opts.fallback } : {}),
    };
    this._steps.push(step);
    return this as unknown as WorkflowBuilder<TInput, unknown>;
  }

  foreach(
    iterableFrom: string,
    step: Step,
    opts?: { id?: string; concurrency?: number },
  ): WorkflowBuilder<TInput, unknown[]> {
    this.assertNotCommitted();
    const id = opts?.id ?? `foreach_${this._steps.length}`;
    validateStepId(id);
    validateStepId(iterableFrom);
    validateStepId(step.id);
    const node: ForeachStep = {
      kind: "foreach",
      id,
      iterableFrom,
      step,
      ...(opts?.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
    };
    this._steps.push(node);
    return this as unknown as WorkflowBuilder<TInput, unknown[]>;
  }

  dowhile(
    step: Step,
    condFn: DowhileStep["condFn"],
    opts?: { id?: string; maxIterations?: number },
  ): WorkflowBuilder<TInput, unknown> {
    this.assertNotCommitted();
    const id = opts?.id ?? `dowhile_${this._steps.length}`;
    validateStepId(id);
    validateStepId(step.id);
    const node: DowhileStep = {
      kind: "dowhile",
      id,
      step,
      condFn,
      ...(opts?.maxIterations !== undefined ? { maxIterations: opts.maxIterations } : {}),
    };
    this._steps.push(node);
    return this as unknown as WorkflowBuilder<TInput, unknown>;
  }

  sleep(durationMs: number, id?: string): WorkflowBuilder<TInput, TOutput> {
    this.assertNotCommitted();
    const stepId = id ?? `sleep_${this._steps.length}`;
    validateStepId(stepId);
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error(`sleep durationMs must be finite non-negative: ${durationMs}`);
    }
    const step: SleepStep = { kind: "sleep", id: stepId, durationMs };
    this._steps.push(step);
    return this;
  }

  suspend(opts?: { id?: string; payloadSchema?: ZodType }): WorkflowBuilder<TInput, unknown> {
    this.assertNotCommitted();
    const id = opts?.id ?? `suspend_${this._steps.length}`;
    validateStepId(id);
    const step: SuspendStep = {
      kind: "suspend",
      id,
      ...(opts?.payloadSchema !== undefined ? { payloadSchema: opts.payloadSchema } : {}),
    };
    this._steps.push(step);
    return this as unknown as WorkflowBuilder<TInput, unknown>;
  }

  commit(): Workflow<TInput, TOutput> {
    this.assertNotCommitted();
    this.validateUniqueIds();
    this._committed = true;
    // EC-5 absorbed: mint unique workflowId so single-flight lock is per-instance
    const workflowId = `wf-${mintShortId()}`;
    return new Workflow<TInput, TOutput>({ ...this.options, workflowId }, [...this._steps]);
  }

  private validateUniqueIds(): void {
    const seen = new Set<string>();
    walkStepsValidating(this._steps, seen);
  }

  private assertNotCommitted(): void {
    if (this._committed) {
      throw new Error("Workflow already committed; create a fresh Workflow.create(...) call.");
    }
  }
}

/* ─── Workflow class ─── */

export class Workflow<TInput = unknown, TOutput = unknown> {
  /** @internal */
  constructor(
    private readonly _options: WorkflowOptions,
    private readonly _steps: ReadonlyArray<Step>,
  ) {}

  /** @internal — only the executor reads these. */
  get __options(): WorkflowOptions {
    return this._options;
  }
  /** @internal */
  get __steps(): ReadonlyArray<Step> {
    return this._steps;
  }

  /**
   * Construct a workflow builder. Validate options via Zod and return a
   * `WorkflowBuilder` for fluent chaining. Call `.commit()` to obtain the
   * immutable `Workflow`.
   */
  static create<TI = unknown, TO = unknown>(options: WorkflowOptions): WorkflowBuilder<TI, TO> {
    WorkflowOptionsSchema.parse(options);
    return new WorkflowBuilder<TI, TO>(options);
  }

  /**
   * Run this workflow with the given input. Returns a populated
   * `WorkflowRun`. Errors inside a step DO NOT throw — they propagate via
   * `run.status === "failed"`.
   */
  async run(input: TInput, opts?: WorkflowRunOptions): Promise<WorkflowRun<TOutput>> {
    // Lazy import to keep the public façade lean.
    const { executeWorkflow } = await import("./internal/workflow/executor.js");
    return executeWorkflow<TInput, TOutput>(this._options, this._steps, input, opts);
  }

  /**
   * Resume a suspended workflow from its snapshot. Throws
   * `WorkflowSnapshotNotFoundError` if `runId` is unknown.
   */
  static async resume<TO = unknown>(opts: WorkflowResumeOptions): Promise<WorkflowRun<TO>> {
    const { resumeWorkflow } = await import("./internal/workflow/executor.js");
    return resumeWorkflow<TO>(opts);
  }
}

/* ─── Helper factory functions ─── */

/**
 * Build a `FnStep`. `id` must match `^[a-z0-9][a-z0-9_-]*$`.
 */
export function fn<I = unknown, O = unknown>(
  id: string,
  step: (input: I, ctx: StepContext) => Promise<O> | O,
  opts?: { inputSchema?: ZodType; outputSchema?: ZodType; retry?: RetryPolicy },
): FnStep {
  validateStepId(id);
  if (opts?.retry !== undefined) RetryPolicySchema.parse(opts.retry);
  return {
    kind: "fn",
    id,
    fn: step as FnStep["fn"],
    ...(opts?.inputSchema !== undefined ? { inputSchema: opts.inputSchema } : {}),
    ...(opts?.outputSchema !== undefined ? { outputSchema: opts.outputSchema } : {}),
    ...(opts?.retry !== undefined ? { retry: opts.retry } : {}),
  };
}

/**
 * Build an `AgentStep`. The `promptTemplate` can be a static string or a
 * function that receives the input and returns the prompt.
 */
export function agentStep(
  id: string,
  agent: SDKAgent,
  promptTemplate: string | ((input: unknown) => string),
  opts?: { retry?: RetryPolicy },
): AgentStep {
  validateStepId(id);
  if (opts?.retry !== undefined) RetryPolicySchema.parse(opts.retry);
  return {
    kind: "agent",
    id,
    agent,
    promptTemplate,
    ...(opts?.retry !== undefined ? { retry: opts.retry } : {}),
  };
}

/* ─── Test seam re-export ─── */

export { __resetSnapshotStoresForTests } from "./internal/workflow/snapshot-store.js";

/* ─── Re-exports for ergonomics (errors only — public types come from `types/workflow.js` via `types/index.ts`). ─── */

export {
  WorkflowAlreadyRunningError,
  WorkflowCompensateNotImplementedError,
  WorkflowDuplicateStepIdError,
  WorkflowMaxIterationsExceededError,
  WorkflowNotSerializableError,
  WorkflowParallelError,
  WorkflowResumeStepNotFoundError,
  WorkflowSnapshotNotFoundError,
} from "./types/workflow.js";

/* ─── Internal helpers ─── */

function validateStepId(id: string): void {
  // Reuses D81 grammar: ^[a-z0-9][a-z0-9_-]*$
  sanitizeIdentifier(id, { maxLen: 64 });
}

function mintShortId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

function nestedStepsOf(s: Step): ReadonlyArray<ReadonlyArray<Step>> {
  if (s.kind === "parallel") return s.branches;
  if (s.kind === "branch") {
    const groups = s.predicates.map(([, branch]) => branch);
    return s.fallback !== undefined ? [...groups, s.fallback] : groups;
  }
  if (s.kind === "foreach" || s.kind === "dowhile") return [[s.step]];
  return [];
}

function walkStepsValidating(steps: ReadonlyArray<Step>, seen: Set<string>): void {
  for (const s of steps) {
    if (seen.has(s.id)) throw new WorkflowDuplicateStepIdError(s.id);
    seen.add(s.id);
    for (const nested of nestedStepsOf(s)) {
      walkStepsValidating(nested, seen);
    }
  }
}
