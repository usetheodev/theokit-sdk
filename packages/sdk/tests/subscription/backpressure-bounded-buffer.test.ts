import { describe, expect, it } from "vitest";
import { BoundedBuffer } from "../../src/subscription/internal/backpressure.js";

describe("streaming backpressure", () => {
  it("fast producer + slow consumer — buffer never exceeds limit", async () => {
    const buf = new BoundedBuffer<number>({ highWaterMark: 8 });
    const pushes: Promise<void>[] = [];
    for (let i = 0; i < 50; i++) {
      pushes.push(buf.push(i));
    }
    let maxSeen = 0;
    for (let i = 0; i < 50; i++) {
      if (buf.size > maxSeen) maxSeen = buf.size;
      buf.pull();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(pushes);
    expect(maxSeen).toBeLessThanOrEqual(8);
  });
});
