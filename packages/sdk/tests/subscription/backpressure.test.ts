import { describe, expect, it } from "vitest";
import { BoundedBuffer } from "../../src/subscription/internal/backpressure.js";

describe("BoundedBuffer", () => {
  it("accepts pushes up to highWaterMark without blocking", async () => {
    const buf = new BoundedBuffer<string>({ highWaterMark: 4 });
    buf.push("a");
    buf.push("b");
    buf.push("c");
    buf.push("d");
    expect(buf.size).toEqual(4);
  });

  it("5th push blocks until pull frees a slot", async () => {
    const buf = new BoundedBuffer<string>({ highWaterMark: 4 });
    for (let i = 0; i < 4; i++) buf.push(`item-${i}`);
    let resolved = false;
    const pushPromise = buf.push("item-4").then(() => {
      resolved = true;
    });
    // Should NOT have resolved yet
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);
    expect(buf.size).toEqual(4);
    // Pull one item — unblocks the push
    const pulled = buf.pull();
    expect(pulled).toEqual("item-0");
    await pushPromise;
    expect(resolved).toBe(true);
    expect(buf.size).toEqual(4);
  });

  it("buffer size never exceeds highWaterMark with slow consumer", async () => {
    const buf = new BoundedBuffer<number>({ highWaterMark: 10 });
    const pushPromises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      pushPromises.push(buf.push(i));
    }
    // Consume all
    let maxSize = 0;
    for (let i = 0; i < 100; i++) {
      if (buf.size > maxSize) maxSize = buf.size;
      buf.pull();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(pushPromises);
    expect(maxSize).toBeLessThanOrEqual(10);
  });

  it("EC-2: push uses queueMicrotask to prevent deadlock", async () => {
    const buf = new BoundedBuffer<string>({ highWaterMark: 1, deadlockTimeoutMs: 500 });
    buf.push("first");
    let resolved = false;
    const pushPromise = buf.push("second").then(() => {
      resolved = true;
    });
    // Pull from setTimeout (different task) — should unblock
    setTimeout(() => buf.pull(), 10);
    await pushPromise;
    expect(resolved).toBe(true);
  });

  it("EC-2: deadlockTimeoutMs rejects if buffer not drained", async () => {
    const buf = new BoundedBuffer<string>({ highWaterMark: 1, deadlockTimeoutMs: 50 });
    buf.push("first");
    await expect(buf.push("second-will-timeout")).rejects.toThrow("deadlock");
  });

  it("pull returns undefined on empty buffer", () => {
    const buf = new BoundedBuffer<string>({ highWaterMark: 4 });
    expect(buf.pull()).toBeUndefined();
  });
});
