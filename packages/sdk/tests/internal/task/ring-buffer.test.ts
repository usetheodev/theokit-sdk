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
    expect(() => new RingBuffer<number>(0)).toThrow();
    expect(() => new RingBuffer<number>(-1)).toThrow();
  });
});
