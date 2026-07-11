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
import type { MessageOrigin } from "./run.js";

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
  /**
   * SE3 — provenance stamped onto this step's `agent.send()` (forwarded to
   * `RunResult.origin`). Squad sets `{ kind: "peer", from: "agent-<i-1>" }` on
   * every step after the first so a peer-driven turn is attributable.
   */
  readonly origin?: MessageOrigin;
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
  /**
   * SE29 — the workflow's shared state (from `WorkflowOptions.initialState`,
   * mutated by {@link setState}), visible to every subsequent step in the run.
   * `undefined` when no `initialState`/`setState` has run. Persisted across
   * suspend/resume.
   */
  readonly state: unknown;
  /**
   * SE29 — update the shared state for subsequent steps. Validated against
   * `WorkflowOptions.stateSchema` when set (a mismatch throws
   * {@link WorkflowStateError}, which fails the step/run — Rule 8).
   */
  readonly setState: (next: unknown) => void;
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
  /** v1 = pre-SE29 (no `state`); v2 = SE29 (carries `state`). Resume reads both. */
  readonly _schemaVersion: 1 | 2;
  readonly runId: string;
  readonly workflowName: string;
  readonly currentStepId: string;
  readonly suspendedPayload?: unknown;
  readonly stepResults: ReadonlyArray<StepResult>;
  readonly accumulatedInput: unknown;
  /** SE29 — shared state captured at suspend (v2). Absent on a v1 snapshot. */
  readonly state?: unknown;
  readonly suspendedAt: number;
}

/* ─── SE28 — streaming ─── */

/**
 * SE28 — a step-level workflow event emitted by `Workflow.stream()` as top-level
 * steps run. Coarse-grained (one event per top-level step; nested
 * parallel/branch/foreach emit as their single wrapping step), distinct from the
 * token-delta agent stream. Discriminate on `type`.
 *
 * @public
 */
export type WorkflowEvent =
  | { readonly type: "step_started"; readonly stepId: string }
  | { readonly type: "step_completed"; readonly stepId: string; readonly output: unknown }
  | {
      readonly type: "step_failed";
      readonly stepId: string;
      readonly error: { readonly name: string; readonly message: string };
    }
  | { readonly type: "workflow_suspended"; readonly stepId: string }
  | { readonly type: "workflow_completed" };

/**
 * SE28 — the async iterator returned by `Workflow.stream()`. Yields
 * {@link WorkflowEvent}s in execution order; `result` resolves to the same
 * terminal {@link WorkflowRun} the `run()` path returns (the authoritative
 * outcome — the stream ends when the run terminates).
 *
 * @public
 */
export type WorkflowStream<TOutput = unknown> = AsyncIterableIterator<WorkflowEvent> & {
  readonly result: Promise<WorkflowRun<TOutput>>;
};

/* ─── Options ─── */

export interface WorkflowPersistenceOptions {
  readonly backend: "memory" | "json";
  /** Required for `backend: "json"`. */
  readonly dir?: string;
}

export interface WorkflowOptions {
  readonly name: string;
  readonly persistence?: WorkflowPersistenceOptions;
  /**
   * SE27 — Zod schema for the WHOLE workflow's input. When set, `run(input)`
   * validates `input` BEFORE step 1; a mismatch yields `status: "failed"` with a
   * typed {@link WorkflowInputError} in `error` (fail-fast, no step runs, no
   * silent coerce). Absent ⇒ no whole-workflow input validation (unchanged).
   */
  readonly inputSchema?: ZodType;
  /**
   * SE27 — Zod schema for the workflow's final output. When set, the terminal
   * `completed` output is validated before `WorkflowRun.output` is populated; a
   * mismatch yields `status: "failed"` with a typed {@link WorkflowOutputError}.
   * Only validated on the `completed` path (suspended/failed runs skip it).
   */
  readonly outputSchema?: ZodType;
  /**
   * SE29 — Zod schema for the workflow's shared state (see `StepContext.state` /
   * `setState`). When set, `initialState` and every `setState(next)` are
   * validated against it (a mismatch throws {@link WorkflowStateError}). When
   * `initialState` is absent, `state` starts as `undefined` and validation fires
   * on the first `setState` call.
   */
  readonly stateSchema?: ZodType;
  /**
   * SE29 — the initial shared state, seeded onto `StepContext.state` before
   * step 1. Validated against `stateSchema` when both are set. Persisted across
   * suspend/resume.
   */
  readonly initialState?: unknown;
  /** Internal — minted at `.commit()`. Not user-facing. */
  readonly workflowId?: string;
}

export interface WorkflowRunOptions {
  readonly signal?: AbortSignal;
  /** Override run ID for deterministic resume (advanced; default = mintRunId). */
  readonly runId?: string;
  /**
   * Opt-in Task wrapping (ADRs D363, D374). Registers the workflow run
   * as a `Task` (kind="workflow") with a `wf-` namespaced id (D368,
   * EC-5). The task transitions terminal when `Workflow.run` resolves.
   *
   * Auto-id: `wf-{runId}`.
   *
   * @public
   */
  readonly task?: true | { id?: string; meta?: Record<string, unknown> };
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

/**
 * SE27 — the whole-workflow `inputSchema` rejected `run(input)` (before step 1).
 * `detail` is a pre-formatted issues summary (a string, NOT Zod's `ZodIssue[]`).
 */
export class WorkflowInputError extends Error {
  override readonly name = "WorkflowInputError";
  constructor(
    public readonly workflowName: string,
    public readonly detail: string,
  ) {
    super(`Workflow "${workflowName}" input failed schema validation: ${detail}`);
  }
}

/**
 * SE27 — the whole-workflow `outputSchema` rejected the final output (on `completed`).
 * `detail` is a pre-formatted issues summary (a string, NOT Zod's `ZodIssue[]`).
 */
export class WorkflowOutputError extends Error {
  override readonly name = "WorkflowOutputError";
  constructor(
    public readonly workflowName: string,
    public readonly detail: string,
  ) {
    super(`Workflow "${workflowName}" output failed schema validation: ${detail}`);
  }
}

/**
 * SE29 — `WorkflowOptions.stateSchema` rejected an `initialState` or a
 * `setState(next)` call. `detail` is a pre-formatted issues summary.
 */
export class WorkflowStateError extends Error {
  override readonly name = "WorkflowStateError";
  constructor(
    public readonly workflowName: string,
    public readonly detail: string,
  ) {
    super(`Workflow "${workflowName}" state failed schema validation: ${detail}`);
  }
}

/**
 * SE30 — a nested workflow (via `workflowStep`) did not `complete`. A nested
 * `suspended` is NOT resumable in v1 (resume continues AFTER the step, so the
 * child would be skipped) — restructure with a top-level suspend. A nested
 * `failed`/`cancelled` fails the parent step with the child's error attached.
 */
export class WorkflowNestedError extends Error {
  override readonly name = "WorkflowNestedError";
  constructor(
    public readonly stepId: string,
    public readonly childName: string,
    public readonly childStatus: string,
    public readonly childError?: { name: string; message: string },
  ) {
    super(
      `Nested workflow "${childName}" (step "${stepId}") ended with status "${childStatus}"${
        childStatus === "suspended"
          ? " — nested suspend/resume is not supported in v1 (use a top-level suspend)"
          : ""
      }${childError ? `: ${childError.message}` : ""}`,
    );
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
