/**
 * Errors raised by the Task API (`src/task.ts`).
 *
 * One actor, one module: these three are about task identity and task lifecycle, and they change
 * when the Task surface changes rather than when the agent-run surface does. They extend
 * `TheokitAgentError` like every other error in this package — the hierarchy is the contract, and
 * `tests/lint/every-error-is-in-the-hierarchy.test.ts` enforces it wherever the class lives.
 *
 * Re-exported from `errors.ts`, so `@theokit/sdk/errors` still names every error in one place.
 *
 * NOTE ON THE MODULE TAG: this header deliberately carries no internal-visibility tag, and does not
 * even name one — TypeScript attaches a file-leading docblock to the FIRST declaration below it, and
 * `stripInternal: true` (tsconfig.base) then deletes that declaration from the emitted `.d.ts`.
 * `tsc --noEmit` stays clean and the declaration rollup fails with `"X" is not exported by "..."`.
 * Measured twice on this file on 2026-09-01: once with the tag, and again when the comment
 * EXPLAINING the trap quoted the tag verbatim and re-armed it.
 */

import { TheokitAgentError } from "./errors-base.js";

/**
 * Thrown when a user-supplied task ID violates the grammar
 * `^[a-z0-9][a-z0-9_-]*$` (D368) OR starts with a reserved adapter
 * prefix (`wf-` / `b-` / `cron-`, EC-5).
 *
 * @public
 */
export class InvalidTaskIdError extends TheokitAgentError {
  override readonly name: string = "InvalidTaskIdError";
  readonly taskId: string;

  constructor(message: string, taskId: string, options: { cause?: unknown } = {}) {
    super(message, {
      ...options,
      isRetryable: false,
      code: "invalid_task_id",
    });
    this.taskId = taskId;
  }
}

/**
 * Thrown when `Task.subscribe(id)` is called for a task that has been
 * evicted, never submitted, or evicted after retention (D373).
 *
 * @public
 */
export class TaskNotFoundError extends TheokitAgentError {
  override readonly name: string = "TaskNotFoundError";
  readonly taskId: string;

  constructor(taskId: string, options: { cause?: unknown } = {}) {
    super(`Task not found: ${taskId}`, {
      ...options,
      isRetryable: false,
      code: "task_not_found",
    });
    this.taskId = taskId;
  }
}

/**
 * Thrown when `CloudAgent` is asked to wrap a task (D370). Cloud
 * task observability is deferred until Theo PaaS GA.
 *
 * @public
 */
export class UnsupportedTaskOperationError extends TheokitAgentError {
  override readonly name: string = "UnsupportedTaskOperationError";
  readonly operation: string;

  constructor(operation: string, options: { cause?: unknown } = {}) {
    super(
      `Task operation "${operation}" is not supported on CloudAgent (pre-release; see ADR D370)`,
      {
        ...options,
        isRetryable: false,
        code: "task_op_unsupported",
      },
    );
    this.operation = operation;
  }
}
