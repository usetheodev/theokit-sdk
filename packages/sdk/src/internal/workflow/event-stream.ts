/**
 * SE28 — a minimal pushable async iterator for `Workflow.stream()`. The executor
 * pushes {@link WorkflowEvent}s as steps run; the consumer drains them via
 * `for await`. Buffers events emitted before the consumer is ready; `end()`
 * closes the iterator so a pending/next `next()` resolves `done: true`.
 *
 * @internal
 */

import type { WorkflowEvent } from "../../types/workflow.js";

export interface PushableEventStream extends AsyncIterableIterator<WorkflowEvent> {
  push(event: WorkflowEvent): void;
  end(): void;
}

export function createEventStream(): PushableEventStream {
  const buffer: WorkflowEvent[] = [];
  const waiters: Array<(r: IteratorResult<WorkflowEvent>) => void> = [];
  let ended = false;

  const stream: PushableEventStream = {
    push(event: WorkflowEvent): void {
      if (ended) return;
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter({ value: event, done: false });
      else buffer.push(event);
    },
    end(): void {
      if (ended) return;
      ended = true;
      for (const waiter of waiters.splice(0)) waiter({ value: undefined, done: true });
    },
    next(): Promise<IteratorResult<WorkflowEvent>> {
      const buffered = buffer.shift();
      if (buffered !== undefined) return Promise.resolve({ value: buffered, done: false });
      if (ended) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve) => waiters.push(resolve));
    },
    [Symbol.asyncIterator](): PushableEventStream {
      return stream;
    },
  };
  return stream;
}
