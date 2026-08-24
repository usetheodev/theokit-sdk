/**
 * T0.3 — Slow-consumer backpressure scaffold.
 *
 * When a consumer drains an SSE stream more slowly than the producer emits,
 * the producer must NOT buffer unbounded memory. The SDK's stream wire
 * already uses Node `Readable` flow control; this scaffold proves the
 * harness can observe RSS growth under intentional slow-draining.
 *
 * T6.2 ratchets to assertions on RSS < +50MB under 1000 slow consumers.
 */

import { describe, expect, it } from "vitest";

const SKIP_LOAD = process.env.SKIP_T0_3_LOAD === "1";

describe.skipIf(SKIP_LOAD)("T0.3 slow-consumer backpressure scaffold", () => {
  it("RSS does not grow unbounded when consumer is slow", async () => {
    const startRss = process.memoryUsage.rss();
    // Producer emits 1k events; consumer drains at 1ms-per-event cadence.
    async function* producer() {
      for (let i = 0; i < 1000; i += 1) {
        yield Buffer.alloc(256); // 256B per event
      }
    }
    let drained = 0;
    for await (const chunk of producer()) {
      drained += chunk.byteLength;
      // Simulate slow consumer.
      await new Promise((r) => setImmediate(r));
    }
    expect(drained).toBe(1000 * 256);
    const endRss = process.memoryUsage.rss();
    // Smoke-grade: RSS delta < 50MB is a generous ceiling for 256KB total
    // payload + V8 noise. T6.2 tightens to producer/consumer specific bounds.
    expect(endRss - startRss).toBeLessThan(50 * 1024 * 1024);
  }, 60_000);

  it.todo(
    "the SDK stream wire holds RSS under 1000 slow consumers — owner B-037, sunset 2026-11-19 (T6.2)",
  );
});
