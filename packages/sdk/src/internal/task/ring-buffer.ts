/**
 * Bounded FIFO ring buffer for late-attach replay (ADR D372).
 *
 * Push always succeeds; when the buffer is at capacity the oldest
 * entry is dropped and the `truncated` flag flips to `true`. Drain
 * returns a snapshot + the current truncated flag.
 *
 * @internal
 */

export class RingBuffer<T> {
  private readonly buf: T[] = [];
  private truncated = false;

  constructor(private readonly cap: number) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error(`RingBuffer capacity must be a positive integer, got ${cap}`);
    }
  }

  push(item: T): void {
    if (this.buf.length >= this.cap) {
      this.buf.shift();
      this.truncated = true;
    }
    this.buf.push(item);
  }

  drain(): { readonly items: readonly T[]; readonly truncated: boolean } {
    return { items: this.buf.slice(), truncated: this.truncated };
  }

  size(): number {
    return this.buf.length;
  }

  wasTruncated(): boolean {
    return this.truncated;
  }
}
