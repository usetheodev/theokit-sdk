/**
 * `TaskRegistry` — the singleton coordinating Task submit/list/get/cancel/
 * subscribe. Wraps the pluggable `TaskStore` (D364), the `AsyncSemaphore`
 * (D135 / D369) and a per-task `RingBuffer<TaskEvent>` (D372) for
 * late-attach replay.
 *
 * Edge cases absorbed:
 *   - EC-3: work-fn invocation goes through `Promise.resolve().then(...)`
 *     so synchronous throws become rejected promises.
 *   - EC-4: pre-aborted signal short-circuits to `cancelled` without
 *     acquiring a semaphore slot.
 *   - EC-7: cross-process cancel via the `cancelRequested` flag on
 *     `TaskHandle`. Registry polls at start + each progress event.
 *   - EC-9: store-update failures are caught + logged; the event is
 *     still emitted so subscribers always observe a terminal event.
 *   - EC-10: subscribe iterator implements `return()` for leak-free
 *     cleanup.
 *   - EC-11: reentrant submit (work-fn calling `Task.submit`) uses an
 *     ALS marker to bypass the semaphore queue, avoiding deadlock under
 *     low concurrency caps.
 *
 * @internal
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { InvalidTaskIdError } from "../../errors.js";
import type {
  TaskCancelResult,
  TaskEvent,
  TaskFilter,
  TaskHandle,
  TaskKind,
  TaskState,
  TaskStoreOptions,
} from "../../types/task.js";
import { type AsyncSemaphore, createSemaphore } from "../concurrency/async-semaphore.js";
import { diag } from "../diagnostics.js";
import { emitRunEvent } from "../emit-run-event.js";
import { RingBuffer } from "./ring-buffer.js";
import { getTaskStoreFor, InMemoryTaskStore, type TaskStore } from "./store.js";
import { buildSubscribe } from "./subscribe.js";
import { isValidTaskId } from "./task-id.js";
import { taskEventToRunEvent } from "./task-run-event-bridge.js";
import { startTaskCancelSpan, startTaskSubmitSpan, startTaskTransitionSpan } from "./telemetry.js";

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_RETENTION_MS = 60 * 60 * 1000;
const EVICTION_INTERVAL_MS = 5 * 60 * 1000;
const RING_CAP = 64;

/** EC-11 — ALS flag indicating we are inside a task work-fn. Reentrant submits bypass the semaphore. */
const reentryAls = new AsyncLocalStorage<boolean>();

export interface TaskRegistryOptions {
  readonly store?: TaskStoreOptions;
  readonly maxConcurrent?: number;
  readonly retentionMs?: number;
}

export interface TaskWorkContext {
  readonly signal: AbortSignal;
  emit(payload: unknown): void;
}

type WorkFn<T> = (ctx: TaskWorkContext) => Promise<T> | T;

interface InternalState {
  readonly store: TaskStore;
  readonly semaphore: AsyncSemaphore;
  readonly aborters: Map<string, AbortController>;
  readonly buffers: Map<string, RingBuffer<TaskEvent>>;
  readonly subscribers: Map<string, Set<(e: TaskEvent) => void>>;
  retentionMs: number;
  evictTimer?: NodeJS.Timeout;
  firstSubmitSeen: boolean;
}

function buildState(opts: TaskRegistryOptions): InternalState {
  const store = opts.store === undefined ? new InMemoryTaskStore() : getTaskStoreFor(opts.store);
  return {
    store,
    semaphore: createSemaphore(opts.maxConcurrent ?? DEFAULT_CONCURRENCY),
    aborters: new Map(),
    buffers: new Map(),
    subscribers: new Map(),
    retentionMs: opts.retentionMs ?? DEFAULT_RETENTION_MS,
    firstSubmitSeen: false,
  };
}

let state: InternalState = buildState({});

export function __resetTaskRegistryForTests(): void {
  if (state.evictTimer !== undefined) clearInterval(state.evictTimer);
  state = buildState({});
}

export function __getSubscribersCountForTests(taskId: string): number {
  return state.subscribers.get(taskId)?.size ?? 0;
}

export function configure(opts: TaskRegistryOptions): void {
  if (state.firstSubmitSeen) {
    diag(
      "[task] configure() ignored — registry already in use; reset via __resetTaskRegistryForTests()\n",
    );
    return;
  }
  if (state.evictTimer !== undefined) clearInterval(state.evictTimer);
  state = buildState(opts);
}

function emitToSubscribers(taskId: string, event: TaskEvent): void {
  const buffer = state.buffers.get(taskId);
  if (buffer !== undefined) buffer.push(event);
  const subs = state.subscribers.get(taskId);
  if (subs === undefined) return;
  for (const cb of subs) {
    try {
      cb(event);
    } catch (err) {
      diag(`[task] subscriber threw: ${(err as Error).message}\n`);
    }
  }
}

async function safeUpdate(
  taskId: string,
  mutate: (h: TaskHandle) => TaskHandle,
): Promise<TaskHandle | undefined> {
  try {
    return await state.store.update(taskId, mutate);
  } catch (err) {
    // EC-9: store failure should not swallow the event.
    diag(`[task] store.update failed for ${taskId}: ${(err as Error).message}\n`);
    return undefined;
  }
}

function startEvictTimerIfNeeded(): void {
  if (state.evictTimer !== undefined) return;
  state.evictTimer = setInterval(() => {
    const cutoff = Date.now() - state.retentionMs;
    void state.store
      .evictTerminalOlderThan(cutoff)
      .then((count) => {
        if (count === 0) return;
        // Also drop buffers + subscribers for evicted tasks. We don't
        // know which ones were dropped — clean up any task whose store
        // entry is gone.
        for (const id of state.buffers.keys()) {
          void state.store.get(id).then((h) => {
            if (h === undefined) {
              state.buffers.delete(id);
              state.subscribers.delete(id);
              state.aborters.delete(id);
            }
          });
        }
      })
      .catch(() => {
        /* swallow timer errors */
      });
  }, EVICTION_INTERVAL_MS).unref();
}

function buildSubmittedEvent(handle: TaskHandle): TaskEvent {
  return {
    type: "submitted",
    taskId: handle.id,
    kind: handle.kind,
    submittedAt: handle.submittedAt,
    ...(handle.meta !== undefined ? { meta: handle.meta } : {}),
  };
}

async function shortCircuitAborted(handle: TaskHandle, signal: AbortSignal): Promise<TaskHandle> {
  // EC-4: pre-aborted signal — skip queue/semaphore.
  const cancelled: TaskHandle = {
    ...handle,
    state: "cancelled",
    cancelledAt: Date.now(),
  };
  await state.store.insert(cancelled);
  state.buffers.set(handle.id, new RingBuffer(RING_CAP));
  emitToSubscribers(handle.id, buildSubmittedEvent(cancelled));
  emitToSubscribers(handle.id, {
    type: "cancelled",
    taskId: handle.id,
    cancelledAt: cancelled.cancelledAt ?? Date.now(),
    reason: signal.reason instanceof Error ? signal.reason.message : "pre-aborted",
  });
  return cancelled;
}

async function transition<T extends TaskState>(
  taskId: string,
  next: T,
  patch: Partial<TaskHandle>,
): Promise<void> {
  const before = await state.store.get(taskId);
  const span = startTaskTransitionSpan({
    taskId,
    from: before?.state ?? "unknown",
    to: next,
  });
  try {
    await safeUpdate(taskId, (h) => ({ ...h, state: next, ...patch }));
  } finally {
    span.end();
  }
}

interface SubmitInternal<T> {
  readonly kind: TaskKind;
  readonly work: WorkFn<T>;
  readonly id?: string;
  readonly meta?: Record<string, unknown>;
  readonly signal?: AbortSignal;
  /** When true (adapter-internal), the validator allows reserved prefixes. */
  readonly allowReservedPrefix?: boolean;
  /** SE2 — forward this task's lifecycle to the run-event sink as `task_*` RunEvents. */
  readonly onRunEvent?: import("../../types/run-events.js").RunEventSink;
}

async function buildAndInsertQueued(
  internal: SubmitInternal<unknown>,
  resolvedId: string,
): Promise<TaskHandle> {
  const submittedAt = Date.now();
  const handle: TaskHandle = {
    id: resolvedId,
    kind: internal.kind,
    state: "queued",
    submittedAt,
    ...(internal.meta !== undefined ? { meta: internal.meta } : {}),
  };
  await state.store.insert(handle);
  state.buffers.set(resolvedId, new RingBuffer(RING_CAP));
  emitToSubscribers(resolvedId, buildSubmittedEvent(handle));
  return handle;
}

function resolveIdInternal(internal: SubmitInternal<unknown>): string {
  if (internal.id === undefined) return randomUUID();
  if (!isValidTaskId(internal.id, internal.allowReservedPrefix ?? false)) {
    throw new InvalidTaskIdError(`invalid task id: ${internal.id}`, internal.id);
  }
  return internal.id;
}

async function runWorkAndFinalize<T>(
  taskId: string,
  aborter: AbortController,
  work: WorkFn<T>,
): Promise<void> {
  const ctx: TaskWorkContext = {
    signal: aborter.signal,
    emit(payload) {
      // EC-7: check cancelRequested at every progress checkpoint.
      void checkCancelRequestedAt(taskId, aborter);
      emitToSubscribers(taskId, {
        type: "progress",
        taskId,
        at: Date.now(),
        payload,
      });
    },
  };

  try {
    const result = await reentryAls.run(true, () => Promise.resolve().then(() => work(ctx)));
    if (aborter.signal.aborted) {
      const cancelledAt = Date.now();
      await transition(taskId, "cancelled", { cancelledAt });
      emitToSubscribers(taskId, { type: "cancelled", taskId, cancelledAt });
      return;
    }
    const finishedAt = Date.now();
    await transition(taskId, "finished", { finishedAt, result });
    emitToSubscribers(taskId, { type: "finished", taskId, finishedAt, result });
  } catch (err) {
    if (aborter.signal.aborted) {
      const cancelledAt = Date.now();
      await transition(taskId, "cancelled", { cancelledAt });
      emitToSubscribers(taskId, { type: "cancelled", taskId, cancelledAt });
      return;
    }
    const erroredAt = Date.now();
    const error =
      err instanceof Error
        ? { code: (err as { code?: string }).code ?? "work_threw", message: err.message }
        : { code: "work_threw", message: String(err) };
    await transition(taskId, "error", { erroredAt, error });
    emitToSubscribers(taskId, { type: "errored", taskId, erroredAt, error });
  }
}

async function checkCancelRequestedAt(taskId: string, aborter: AbortController): Promise<void> {
  if (aborter.signal.aborted) return;
  try {
    const handle = await state.store.get(taskId);
    if (handle?.cancelRequested === true) {
      aborter.abort("cancelRequested");
    }
  } catch {
    /* ignore — best-effort poll */
  }
}

async function acquireSlot(): Promise<() => void> {
  if (reentryAls.getStore() === true) {
    // EC-11: reentrant submit bypasses the queue.
    return () => {
      /* no-op */
    };
  }
  return state.semaphore.acquire();
}

/**
 * Submit a task. Validates id (D368, EC-5 via allowReservedPrefix),
 * handles pre-aborted signals (EC-4), enforces single-flight by id
 * (D367), runs work under semaphore (D369/EC-11 reentrant bypass),
 * and produces the canonical event stream (D366).
 */
export async function submit<T>(internal: SubmitInternal<T>): Promise<TaskHandle> {
  state.firstSubmitSeen = true;
  startEvictTimerIfNeeded();

  const resolvedId = resolveIdInternal(internal);
  // SE2 — bridge the task lifecycle to the caller's run-event sink (opt-in).
  if (internal.onRunEvent !== undefined) {
    const sink = internal.onRunEvent;
    const kind = internal.kind;
    const subs = state.subscribers.get(resolvedId) ?? new Set();
    subs.add((e: TaskEvent) => {
      const runEvent = taskEventToRunEvent(e, resolvedId, kind);
      if (runEvent !== undefined) emitRunEvent(sink, runEvent);
    });
    state.subscribers.set(resolvedId, subs);
  }
  const submitSpan = startTaskSubmitSpan({ taskId: resolvedId, kind: internal.kind });

  // D367 single-flight.
  const existing = await state.store.get(resolvedId);
  if (existing !== undefined) {
    submitSpan.end();
    return existing;
  }

  const queuedHandle = await buildAndInsertQueued(internal, resolvedId);
  submitSpan.end();

  // EC-4: pre-aborted signal — short-circuit.
  if (internal.signal?.aborted === true) {
    return shortCircuitAborted(queuedHandle, internal.signal);
  }

  const aborter = new AbortController();
  state.aborters.set(resolvedId, aborter);
  if (internal.signal !== undefined) {
    internal.signal.addEventListener("abort", () => aborter.abort(internal.signal?.reason), {
      once: true,
    });
  }

  // Fire and forget the actual run; the returned handle is the queued one.
  const release = await acquireSlot();
  void (async () => {
    try {
      // Check cancelRequested before starting (EC-7).
      await checkCancelRequestedAt(resolvedId, aborter);
      if (aborter.signal.aborted) {
        const cancelledAt = Date.now();
        await transition(resolvedId, "cancelled", { cancelledAt });
        emitToSubscribers(resolvedId, { type: "cancelled", taskId: resolvedId, cancelledAt });
        return;
      }
      const startedAt = Date.now();
      await transition(resolvedId, "running", { startedAt });
      emitToSubscribers(resolvedId, { type: "started", taskId: resolvedId, startedAt });
      await runWorkAndFinalize(resolvedId, aborter, internal.work as WorkFn<unknown>);
    } finally {
      release();
      state.aborters.delete(resolvedId);
    }
  })();

  return queuedHandle;
}

export async function list(filter: TaskFilter = {}): Promise<TaskHandle[]> {
  return state.store.list(filter);
}

export async function get(id: string): Promise<TaskHandle | undefined> {
  if (!isValidTaskId(id, true)) return undefined;
  return state.store.get(id);
}

export async function cancel(id: string, reason?: string): Promise<TaskCancelResult> {
  if (!isValidTaskId(id, true)) return { cancelled: false, alreadyTerminal: false };
  const handle = await state.store.get(id);
  if (handle === undefined) return { cancelled: false, alreadyTerminal: false };
  if (handle.state === "finished" || handle.state === "error" || handle.state === "cancelled") {
    return { cancelled: false, alreadyTerminal: true };
  }
  const span = startTaskCancelSpan({
    taskId: id,
    ...(reason !== undefined ? { reason } : {}),
    via: "api",
  });
  try {
    return await cancelInternal(id, handle.state, reason);
  } finally {
    span.end();
  }
}

async function cancelInternal(
  id: string,
  currentState: TaskState,
  reason?: string,
): Promise<TaskCancelResult> {
  if (currentState === "queued") {
    const cancelledAt = Date.now();
    await transition(id, "cancelled", { cancelledAt });
    emitToSubscribers(id, {
      type: "cancelled",
      taskId: id,
      cancelledAt,
      ...(reason !== undefined ? { reason } : {}),
    });
    state.aborters.delete(id);
    return { cancelled: true, alreadyTerminal: false };
  }
  // running: trigger AbortController; runWorkAndFinalize handles the transition.
  const aborter = state.aborters.get(id);
  if (aborter !== undefined) aborter.abort(reason ?? "cancelled");
  return { cancelled: true, alreadyTerminal: false };
}

export const subscribe = buildSubscribe({
  getBuffer: (id) => state.buffers.get(id),
  getOrCreateSubscriberSet: (id) => {
    let subs = state.subscribers.get(id);
    if (subs === undefined) {
      subs = new Set();
      state.subscribers.set(id, subs);
    }
    return subs;
  },
  removeSubscriber: (id, cb) => {
    const set = state.subscribers.get(id);
    set?.delete(cb);
    if (set !== undefined && set.size === 0) state.subscribers.delete(id);
  },
});
