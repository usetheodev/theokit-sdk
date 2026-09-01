/**
 * Owner: `internal/task/` (4 of 5 importers). Derived from the import graph, not declared —
 * `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 * Public type contract for the Task observability registry (ADRs D361-D374).
 *
 * Tasks are an opt-in observability layer over async work in the SDK
 * (`Agent.send`, `Agent.batch`, `Workflow.run`, `Cron` fires). They have
 * a closed 5-state lifecycle (D362), discriminated events (D366), and a
 * pluggable store (D364). The `Task` facade in `task.ts` is the public
 * surface; consumers import these types from `@theokit/sdk`.
 *
 * @public
 */

/**
 * Closed enum of the 5 lifecycle states (D362).
 *
 * Transitions are acyclic:
 *   queued → running → (finished | error | cancelled)
 *   queued → cancelled (direct, no run started)
 */
export type TaskState = "queued" | "running" | "finished" | "error" | "cancelled";

/** Discriminator of the runtime that produced a task (D374). */
export type TaskKind = "run" | "batch" | "workflow" | "cron" | "custom";

/** Discriminated union of task lifecycle events (D366). */
export type TaskEvent =
  | {
      readonly type: "submitted";
      readonly taskId: string;
      readonly kind: TaskKind;
      readonly submittedAt: number;
      readonly meta?: Record<string, unknown>;
      /** D372 — flag set on the first yielded event when the ring buffer was at cap. */
      readonly truncated?: boolean;
    }
  | { readonly type: "started"; readonly taskId: string; readonly startedAt: number }
  | {
      readonly type: "progress";
      readonly taskId: string;
      readonly at: number;
      readonly payload: unknown;
    }
  | {
      readonly type: "finished";
      readonly taskId: string;
      readonly finishedAt: number;
      readonly result: unknown;
    }
  | {
      readonly type: "errored";
      readonly taskId: string;
      readonly erroredAt: number;
      readonly error: { readonly code: string; readonly message: string };
    }
  | {
      readonly type: "cancelled";
      readonly taskId: string;
      readonly cancelledAt: number;
      readonly reason?: string;
    };

/** Public read-only view of a task entry in the registry. */
export interface TaskHandle {
  readonly id: string;
  readonly kind: TaskKind;
  readonly state: TaskState;
  readonly submittedAt: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly cancelledAt?: number;
  readonly erroredAt?: number;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
  readonly meta?: Record<string, unknown>;
  /**
   * EC-7 — cross-process best-effort cancel flag. Set by CLI
   * `theokit tasks cancel` via JsonFileTaskStore. The owning process
   * polls at checkpoints and honors via AbortController. Always
   * `undefined` for in-process cancel paths (which go directly through
   * AbortController).
   */
  readonly cancelRequested?: boolean;
  /**
   * Why the task was cancelled, when whoever cancelled it said. Free text, written alongside
   * `cancelledAt` for a `queued` task and alongside `cancelRequested` for a `running` one.
   *
   * Absent when no reason was given — an empty string is not a reason, and a default like
   * "cancelled" would put words in the operator's mouth. `theokit tasks cancel --reason` is what
   * writes it (#351); nothing in the runtime reads it, because it exists for the human reading the
   * registry later.
   */
  readonly cancelReason?: string;
}

/** Query filter for `Task.list`. */
export interface TaskFilter {
  readonly state?: TaskState | readonly TaskState[];
  readonly kind?: TaskKind | readonly TaskKind[];
  readonly submittedAfter?: number;
  readonly submittedBefore?: number;
  /**
   * Defaults to 100. `JsonFileTaskStore` returns the newest matching tasks first and reads its
   * whole directory to find them (256 files at a time); page past this limit with
   * `submittedBefore` (#362).
   */
  readonly limit?: number;
}

/** Options for `Task.submit`. */
export interface TaskSubmitOptions {
  /**
   * Optional user-supplied ID. Must match grammar `^[a-z0-9][a-z0-9_-]*$`
   * and MUST NOT start with the reserved prefixes `wf-` / `b-` / `cron-`
   * (D368, EC-5). When omitted, `crypto.randomUUID()` is used.
   */
  readonly id?: string;
  readonly meta?: Record<string, unknown>;
  /**
   * Optional caller-provided AbortSignal. If already aborted at submit
   * time, the registry short-circuits to `cancelled` without acquiring
   * a semaphore slot (EC-4).
   */
  readonly signal?: AbortSignal;
  /**
   * SE2 — an opt-in {@link import("./run-events.js").RunEventSink}. The task's
   * lifecycle is forwarded to it as typed `task_started` / `task_updated` /
   * `task_completed` RunEvents, so a caller that spawned the task can observe it
   * through the same `onRunEvent` channel as the rest of the run. Best-effort (a
   * throwing sink never breaks the task). The dedicated `Task.subscribe(id)`
   * channel is unaffected.
   */
  readonly onRunEvent?: import("./run-events.js").RunEventSink;
}

/** Options shape for `TaskStore` factory (D364). */
export type TaskStoreOptions =
  | { readonly backend: "memory" }
  | { readonly backend: "json"; readonly dir: string };

/** Result of `Task.cancel` (D365 — idempotent). */
export interface TaskCancelResult {
  readonly cancelled: boolean;
  readonly alreadyTerminal: boolean;
}

/**
 * Grammar for user-supplied task IDs (D368).
 * `crypto.randomUUID()` outputs do NOT match this (UUIDs have dashes
 * AND uppercase letters in their canonical form on some Node versions),
 * but the registry normalizes auto-generated IDs to lowercase before
 * insertion, so they pass the same regex.
 */
const TASK_ID_GRAMMAR = /^[a-z0-9][a-z0-9_-]*$/;

/** Reserved prefixes for adapter-generated IDs (D368, EC-5). */
const RESERVED_PREFIXES = ["wf-", "b-", "cron-"] as const;

/**
 * Validates a task ID against the public grammar + reserved prefixes.
 * Throws `InvalidTaskIdError` from `../errors.js` on rejection.
 *
 * Adapter callers (workflow/batch/cron) MUST set `allowReserved: true`
 * to register their own IDs; user-facing surfaces (`Task.submit`,
 * `agent.send({ task: { id } })`) leave it false.
 */
export function isValidTaskId(id: string, allowReserved: boolean): boolean {
  if (!TASK_ID_GRAMMAR.test(id)) return false;
  if (allowReserved) return true;
  for (const prefix of RESERVED_PREFIXES) {
    if (id.startsWith(prefix)) return false;
  }
  return true;
}

/** Re-exported for adapter implementations + tests. */
export const TASK_RESERVED_PREFIXES: readonly string[] = RESERVED_PREFIXES;
