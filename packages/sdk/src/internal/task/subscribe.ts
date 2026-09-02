/**
 * `subscribe(id)` — emits the per-task event stream (D372 ring buffer
 * + live tail). The returned AsyncIterable implements `return()` for
 * leak-free cleanup (EC-10).
 *
 * @internal
 */

import { TaskNotFoundError } from "../../errors.js";
import type { TaskEvent } from "../../types/task.js";
import type { RingBuffer } from "./ring-buffer.js";
import { isValidTaskId } from "./task-id.js";

export interface SubscribeDeps {
  getBuffer(id: string): RingBuffer<TaskEvent> | undefined;
  getOrCreateSubscriberSet(id: string): Set<(e: TaskEvent) => void>;
  removeSubscriber(id: string, cb: (e: TaskEvent) => void): void;
}

function isTerminalEvent(event: TaskEvent): boolean {
  return event.type === "finished" || event.type === "errored" || event.type === "cancelled";
}

function drainBuffered(buffer: RingBuffer<TaskEvent>): TaskEvent[] {
  const { items, truncated } = buffer.drain();
  const queue = items.slice();
  if (truncated && queue.length > 0) {
    const first = queue[0];
    if (first !== undefined && first.type === "submitted") {
      queue[0] = { ...first, truncated: true } satisfies TaskEvent;
    }
  }
  return queue;
}

class TaskIterator implements AsyncIterator<TaskEvent> {
  private readonly queue: TaskEvent[];
  private pendingResolve?: (v: IteratorResult<TaskEvent>) => void;
  private done = false;
  private readonly callback: (e: TaskEvent) => void;

  constructor(
    buffer: RingBuffer<TaskEvent>,
    private readonly id: string,
    private readonly deps: SubscribeDeps,
  ) {
    this.queue = drainBuffered(buffer);
    this.callback = (e) => this.deliver(e);
    deps.getOrCreateSubscriberSet(id).add(this.callback);
  }

  private deliver(e: TaskEvent): void {
    if (this.done) return;
    if (this.pendingResolve !== undefined) {
      const r = this.pendingResolve;
      this.pendingResolve = undefined;
      r({ value: e, done: false });
    } else {
      this.queue.push(e);
    }
  }

  private cleanup(): void {
    if (this.done) return;
    this.done = true;
    this.deps.removeSubscriber(this.id, this.callback);
    if (this.pendingResolve !== undefined) {
      const r = this.pendingResolve;
      this.pendingResolve = undefined;
      r({ value: undefined, done: true });
    }
  }

  private dequeue(): IteratorResult<TaskEvent> | undefined {
    const event = this.queue.shift();
    if (event === undefined) return undefined;
    if (isTerminalEvent(event)) queueMicrotask(() => this.cleanup());
    return { value: event, done: false };
  }

  next(): Promise<IteratorResult<TaskEvent>> {
    if (this.done) return Promise.resolve({ value: undefined, done: true });
    const queued = this.dequeue();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  return(): Promise<IteratorResult<TaskEvent>> {
    this.cleanup();
    return Promise.resolve({ value: undefined, done: true });
  }
}

export function buildSubscribe(deps: SubscribeDeps) {
  return function subscribe(id: string): AsyncIterable<TaskEvent> {
    if (!isValidTaskId(id, true)) throw new TaskNotFoundError(id);
    const buffer = deps.getBuffer(id);
    if (buffer === undefined) throw new TaskNotFoundError(id);

    return {
      [Symbol.asyncIterator](): AsyncIterator<TaskEvent> {
        return new TaskIterator(buffer, id, deps);
      },
    };
  };
}
