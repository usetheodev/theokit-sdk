import { describe, expect, it } from "vitest";
import { RingBuffer } from "../../../src/internal/task/ring-buffer.js";

describe("RingBuffer (D372)", () => {
  it("push + drain yields all items without truncated flag", () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    const { items, truncated } = rb.drain();
    expect(items).toEqual([1, 2]);
    expect(truncated).toBe(false);
  });

  it("overflow drops head + marks truncated", () => {
    const rb = new RingBuffer<number>(2);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    const { items, truncated } = rb.drain();
    expect(items).toEqual([2, 3]);
    expect(truncated).toBe(true);
  });

  it("rejects invalid capacity", () => {
    // B-079 — was bare `.toThrow()`. `RingBuffer`'s constructor throws a plain
    // `Error` (it is `@internal`, so a typed SDK error class would buy no caller
    // any branching value); the message is the only stable identifier the guard
    // has, and it names both the requirement and the offending value.
    expect(() => new RingBuffer<number>(0)).toThrow(/capacity must be a positive integer, got 0/);
    expect(() => new RingBuffer<number>(-1)).toThrow(/capacity must be a positive integer, got -1/);
  });
});
