/**
 * BoundedBuffer — backpressure primitive for subscription streams (T10.3, ADR D450).
 *
 * Limits in-flight items between a fast producer (transport) and a slow
 * consumer (AsyncGenerator). When the buffer reaches `highWaterMark`,
 * subsequent `push()` calls return a Promise that blocks until a `pull()`
 * frees a slot.
 *
 * EC-2: uses queueMicrotask in the blocked path to yield to the event loop,
 * preventing deadlock when consumer and producer share the same microtask queue.
 * `deadlockTimeoutMs` rejects the push promise if the buffer is not drained in time.
 *
 * @internal
 */

export interface BoundedBufferOptions {
  highWaterMark: number;
  deadlockTimeoutMs?: number;
}

interface PendingPush<T> {
  item: T;
  resolve: () => void;
  reject: (err: Error) => void;
}

export class BoundedBuffer<T> {
  private readonly _queue: T[] = [];
  private readonly _pending: PendingPush<T>[] = [];
  private readonly _highWaterMark: number;
  private readonly _deadlockTimeoutMs: number;

  constructor(opts: BoundedBufferOptions) {
    this._highWaterMark = opts.highWaterMark;
    this._deadlockTimeoutMs = opts.deadlockTimeoutMs ?? 30_000;
  }

  get size(): number {
    return this._queue.length;
  }

  push(item: T): Promise<void> {
    if (this._queue.length < this._highWaterMark) {
      this._queue.push(item);
      return Promise.resolve();
    }
    // Buffer full — block until pull() frees a slot
    return new Promise<void>((resolve, reject) => {
      const entry: PendingPush<T> = { item, resolve, reject };
      this._pending.push(entry);
      // EC-2: deadlock timeout
      const timer = setTimeout(() => {
        const idx = this._pending.indexOf(entry);
        if (idx !== -1) {
          this._pending.splice(idx, 1);
          reject(
            new Error(
              `BoundedBuffer deadlock: buffer not drained within ${this._deadlockTimeoutMs}ms`,
            ),
          );
        }
      }, this._deadlockTimeoutMs);
      // EC-2: yield to event loop via queueMicrotask so consumers on the
      // same microtask queue get a chance to pull before we block forever
      queueMicrotask(() => {
        // Timer cleanup happens on resolve or reject
        const origResolve = entry.resolve;
        entry.resolve = () => {
          clearTimeout(timer);
          origResolve();
        };
        const origReject = entry.reject;
        entry.reject = (err: Error) => {
          clearTimeout(timer);
          origReject(err);
        };
      });
    });
  }

  pull(): T | undefined {
    const item = this._queue.shift();
    if (item === undefined) return undefined;
    // If there's a pending push, admit it now
    if (this._pending.length > 0) {
      const next = this._pending.shift()!;
      this._queue.push(next.item);
      next.resolve();
    }
    return item;
  }
}
