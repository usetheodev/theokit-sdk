/**
 * Public type contract for `Workflow.create / .run / .resume` (Adoption
 * Roadmap #5; ADRs D230-D248).
 *
 * Step types form a discriminated union by `kind`. Helper factory functions
 * (`fn()`, `agentStep()`) live in `workflow.ts` and hide the discriminator
 * from end users.
 *
 * @public
 */

import type { ZodType } from "zod";

import type { SDKAgent } from "./agent.js";

/* ─── Step discriminated union (D232) ─── */

export type Step =
  | FnStep
  | AgentStep
  | ParallelStep
  | BranchStep
  | ForeachStep
  | DowhileStep
  | SleepStep
  | SuspendStep;

/** A pure function step. */
export interface FnStep {
  readonly kind: "fn";
  readonly id: string;
  readonly fn: (input: unknown, ctx: StepContext) => Promise<unknown> | unknown;
  readonly inputSchema?: ZodType;
  readonly outputSchema?: ZodType;
  readonly retry?: RetryPolicy;
  /** D238 — slot reserved; runtime throws if engine not yet implemented. */
  readonly compensate?: (input: unknown, output: unknown, error: Error) => Promise<void> | void;
}

/** An agent.send-driven step. */
export interface AgentStep {
  readonly kind: "agent";
  readonly id: string;
  readonly agent: SDKAgent;
  readonly promptTemplate: string | ((input: unknown) => string);
  readonly retry?: RetryPolicy;
}

/** N concurrent branches, each its own mini-step-list. */
export interface ParallelStep {
  readonly kind: "parallel";
  readonly id: string;
  readonly branches: ReadonlyArray<ReadonlyArray<Step>>;
  readonly concurrency?: number;
  readonly errorPolicy?: "fail-fast" | "collect";
}

/** First-match-wins predicates + optional fallback. */
export interface BranchStep {
  readonly kind: "branch";
  readonly id: string;
  readonly predicates: ReadonlyArray<
    readonly [(input: unknown) => boolean | Promise<boolean>, ReadonlyArray<Step>]
  >;
  readonly fallback?: ReadonlyArray<Step>;
}

/** Map a step over an upstream array output. */
export interface ForeachStep {
  readonly kind: "foreach";
  readonly id: string;
  /** ID of an upstream top-level step whose output is iterable. */
  readonly iterableFrom: string;
  readonly step: Step;
  readonly concurrency?: number;
}

/** Loop a step until condFn returns false. */
export interface DowhileStep {
  readonly kind: "dowhile";
  readonly id: string;
  readonly step: Step;
  readonly condFn: (output: unknown, iteration: number) => boolean | Promise<boolean>;
  readonly maxIterations?: number;
}

/** Pause for a fixed duration. */
export interface SleepStep {
  readonly kind: "sleep";
  readonly id: string;
  readonly durationMs: number;
}

/** Standalone explicit suspend point. */
export interface SuspendStep {
  readonly kind: "suspend";
  readonly id: string;
  readonly payloadSchema?: ZodType;
}

/* ─── Supporting types ─── */

/** D237 — retry policy applied per fn/agent step. */
export interface RetryPolicy {
  /** Total attempts (MIN 1, MAX 20). `1` = no retry. */
  readonly maxAttempts: number;
  readonly initialBackoffMs?: number;
  readonly backoffCoefficient?: number;
  readonly maximumBackoffMs?: number;
  readonly nonRetryableErrors?: ReadonlyArray<string>;
}

/** D247 — context handed to every step.fn. */
export interface StepContext {
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly log: {
    debug: (msg: string, attrs?: Record<string, unknown>) => void;
    info: (msg: string, attrs?: Record<string, unknown>) => void;
    warn: (msg: string, attrs?: Record<string, unknown>) => void;
  };
  /** Pause the workflow; resume via `Workflow.resume({...})`. */
  readonly suspend: (payload?: unknown) => Promise<never>;
}

/* ─── Result types ─── */

export interface StepResult {
  readonly stepId: string;
  readonly kind: Step["kind"];
  readonly status: "completed" | "failed" | "skipped" | "suspended";
  readonly attempts: number;
  readonly durationMs: number;
  readonly output?: unknown;
  readonly error?: { name: string; message: string };
}

export interface WorkflowRun<TOutput = unknown> {
  readonly id: string;
  readonly name: string;
  readonly status: "running" | "completed" | "failed" | "suspended" | "cancelled";
  readonly output?: TOutput;
  readonly error?: { name: string; message: string };
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly stepResults: ReadonlyArray<StepResult>;
}

export interface WorkflowSnapshot {
  readonly _schemaVersion: 1;
  readonly runId: string;
  readonly workflowName: string;
  readonly currentStepId: string;
  readonly suspendedPayload?: unknown;
  readonly stepResults: ReadonlyArray<StepResult>;
  readonly accumulatedInput: unknown;
  readonly suspendedAt: number;
}

/* ─── Options ─── */

export interface WorkflowPersistenceOptions {
  readonly backend: "memory" | "json";
  /** Required for `backend: "json"`. */
  readonly dir?: string;
}

export interface WorkflowOptions {
  readonly name: string;
  readonly persistence?: WorkflowPersistenceOptions;
  /** Internal — minted at `.commit()`. Not user-facing. */
  readonly workflowId?: string;
}

export interface WorkflowRunOptions {
  readonly signal?: AbortSignal;
  /** Override run ID for deterministic resume (advanced; default = mintRunId). */
  readonly runId?: string;
}

export interface WorkflowResumeOptions<TI = unknown> {
  readonly runId: string;
  readonly workflow: { run: (input: TI, opts?: WorkflowRunOptions) => Promise<WorkflowRun> };
  readonly payload?: unknown;
  readonly signal?: AbortSignal;
}

/* ─── Error classes ─── */

export class WorkflowDuplicateStepIdError extends Error {
  override readonly name = "WorkflowDuplicateStepIdError";
  constructor(public readonly stepId: string) {
    super(`Duplicate step id "${stepId}" in workflow.`);
  }
}

export class WorkflowAlreadyRunningError extends Error {
  override readonly name = "WorkflowAlreadyRunningError";
  constructor(
    public readonly workflowName: string,
    public readonly runId: string,
  ) {
    super(`Workflow "${workflowName}" run "${runId}" already in-flight.`);
  }
}

export class WorkflowSnapshotNotFoundError extends Error {
  override readonly name = "WorkflowSnapshotNotFoundError";
  constructor(public readonly runId: string) {
    super(`No snapshot found for runId "${runId}". Configure persistence to enable resume.`);
  }
}

export class WorkflowMaxIterationsExceededError extends Error {
  override readonly name = "WorkflowMaxIterationsExceededError";
  constructor(
    public readonly stepId: string,
    public readonly maxIterations: number,
  ) {
    super(`Step "${stepId}" exceeded max iterations (${maxIterations}).`);
  }
}

/** EC-4 absorbed — JSON.stringify failed on snapshot payload. */
export class WorkflowNotSerializableError extends Error {
  override readonly name = "WorkflowNotSerializableError";
  constructor(
    public readonly stepId: string,
    public readonly underlying: Error,
  ) {
    super(
      `Workflow snapshot at step "${stepId}" failed to serialize as JSON: ${underlying.message}. ` +
        `Persisted snapshots support only JSON-serializable values (no BigInt, no circular refs, no class instances with cycles).`,
    );
  }
}

/** EC-8 absorbed — `currentStepId` from snapshot not found in resumed workflow. */
export class WorkflowResumeStepNotFoundError extends Error {
  override readonly name = "WorkflowResumeStepNotFoundError";
  constructor(
    public readonly stepId: string,
    public readonly workflowName: string,
  ) {
    super(
      `Cannot resume: step "${stepId}" not found in workflow "${workflowName}". ` +
        `The Workflow definition diverged from the snapshot.`,
    );
  }
}

/** Aggregate failure from parallel branches. */
export class WorkflowParallelError extends AggregateError {
  override readonly name = "WorkflowParallelError";
  constructor(
    errors: ReadonlyArray<Error>,
    public readonly stepId: string,
  ) {
    super(errors, `${errors.length} branch(es) failed in parallel step "${stepId}".`);
  }
}

/** D238 — saga engine not yet implemented. */
export class WorkflowCompensateNotImplementedError extends Error {
  override readonly name = "WorkflowCompensateNotImplementedError";
  constructor(public readonly stepId: string) {
    super(
      `Step "${stepId}" defines compensate, but saga engine is deferred to v1.2. ` +
        `Remove compensate or implement rollback manually.`,
    );
  }
}
