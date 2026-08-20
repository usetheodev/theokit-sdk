/**
 * `Task` — observable async work registry (Adoption Roadmap gap #2,
 * ADRs D361-D374).
 *
 * Static facade delegating to the in-process `TaskRegistry` singleton.
 * The lifecycle of any task is the 5-state machine `queued | running |
 * finished | error | cancelled` (D362). Wrapping `Agent.send` /
 * `Agent.batch` / `Workflow.run` / `Cron` fires is opt-in via the
 * `{ task: true }` option on each (D363).
 *
 * @public
 */

import {
  cancel as registryCancel,
  configure as registryConfigure,
  get as registryGet,
  list as registryList,
  submit as registrySubmit,
  subscribe as registrySubscribe,
} from "./internal/task/registry.js";
import type {
  TaskCancelResult,
  TaskEvent,
  TaskFilter,
  TaskHandle,
  TaskKind,
  TaskStoreOptions,
  TaskSubmitOptions,
} from "./types/task.js";

export interface TaskWorkContext {
  readonly signal: AbortSignal;
  emit(payload: unknown): void;
}

/**
 * The unit of work handed to {@link Task.submit}.
 *
 * It receives the context rather than raw arguments: `ctx.signal` aborts on cancel and should be
 * observed by anything long-running, and `ctx.emit(payload)` produces a `progress` event for
 * subscribers. May be synchronous — the return type allows a plain value as well as a promise.
 *
 * @public
 */
export type TaskWorkFn<T> = (ctx: TaskWorkContext) => Promise<T> | T;

/**
 * Registry-level configuration. May only be applied BEFORE the first
 * `Task.submit` of the process — see EC-13. Subsequent calls emit a
 * single stderr line and become no-ops.
 */
export interface TaskConfigureOptions {
  readonly store?: TaskStoreOptions;
  readonly maxConcurrent?: number;
  readonly retentionMs?: number;
}

/**
 * Static facade over the process-wide task registry — the observability layer for asynchronous
 * work.
 *
 * Not instantiable: the constructor throws, and every operation is a static that delegates to one
 * in-process singleton. Tasks are an OPT-IN wrapper. `Agent.send`, `Agent.batch`, `Workflow.run`
 * and `Cron` fires only appear here when submitted with `{ task: true }`; work you submit yourself
 * goes through `Task.submit`.
 *
 * Two ordering constraints bite in practice. `Task.configure` must run before the first `submit` of
 * the process — a later call logs one line and is otherwise a no-op. And `Task.get` returning
 * `undefined` does not mean the id never existed: retention evicts terminal tasks, so an id can go
 * from known to unknown over time.
 *
 * @public
 */
export class Task {
  // D361 — static class with private constructor.
  private constructor() {
    throw new Error("Task is static; do not instantiate");
  }

  /**
   * Configure the registry. **Must be called before the first `submit`**
   * (EC-13). Available knobs: pluggable store (D364), concurrency cap
   * (D369), and retention (D373).
   */
  static configure(opts: TaskConfigureOptions): void {
    registryConfigure(opts);
  }

  /**
   * Submit a unit of asynchronous work to the registry.
   *
   * The `work` function receives `{ signal, emit }` — `signal` is the
   * AbortSignal honored on cancel; `emit(payload)` produces a
   * `progress` event observable via `Task.subscribe`.
   *
   * Returns a `TaskHandle` in `state: "queued"`. Subsequent state
   * transitions are observable via `Task.subscribe(handle.id)` OR
   * polled via `Task.get(handle.id)`.
   *
   * **Idempotency (D367):** submitting twice with the same `id` returns
   * the existing handle without re-invoking work.
   *
   * **Grammar (D368):** user-supplied ids must match
   * `^[a-z0-9][a-z0-9_-]*$` and must not start with reserved prefixes
   * `wf-` / `b-` / `cron-`. Otherwise `InvalidTaskIdError` is thrown.
   *
   * **Pre-aborted signal (EC-4):** if `options.signal` is already
   * aborted, the task short-circuits to `cancelled` without acquiring
   * a semaphore slot and without invoking `work`.
   */
  static async submit<T>(
    kind: TaskKind,
    work: TaskWorkFn<T>,
    options: TaskSubmitOptions = {},
  ): Promise<TaskHandle> {
    return registrySubmit<T>({
      kind,
      work,
      ...(options.id !== undefined ? { id: options.id } : {}),
      ...(options.meta !== undefined ? { meta: options.meta } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.onRunEvent !== undefined ? { onRunEvent: options.onRunEvent } : {}),
    });
  }

  /** Returns matching handles, capped at `filter.limit ?? 100`. */
  static list(filter: TaskFilter = {}): Promise<TaskHandle[]> {
    return registryList(filter);
  }

  /** Returns a single handle by id, or `undefined` if unknown / evicted. */
  static get(id: string): Promise<TaskHandle | undefined> {
    return registryGet(id);
  }

  /**
   * Idempotent cancel (D365). Returns:
   *   - `{ cancelled: true, alreadyTerminal: false }` — transitioned
   *     queued/running task to `cancelled`.
   *   - `{ cancelled: false, alreadyTerminal: true }` — task already
   *     terminal.
   *   - `{ cancelled: false, alreadyTerminal: false }` — task unknown.
   *
   * Never throws.
   */
  static cancel(id: string, reason?: string): Promise<TaskCancelResult> {
    return registryCancel(id, reason);
  }

  /**
   * Subscribe to a task's event stream. The returned `AsyncIterable<TaskEvent>`
   * starts by replaying buffered events (ring buffer cap 64, D372) and
   * then yields live events until a terminal event (finished / errored
   * / cancelled) is emitted, at which point it closes automatically.
   *
   * Calling `.return()` on the iterator (or `break` in a `for await`)
   * cleans up the subscriber callback (EC-10).
   *
   * Throws `TaskNotFoundError` if the id is unknown or has been evicted.
   */
  static subscribe(id: string): AsyncIterable<TaskEvent> {
    return registrySubscribe(id);
  }
}
