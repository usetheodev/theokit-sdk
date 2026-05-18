import { describe, expect, it } from "vitest";

import { consumeDataStream } from "../src/internal/sse-parser.js";

/**
 * Tests for `streamAssistant` wire format — Phase 2.2 of v1.2 plan (ADR D45).
 * Validate o:/O: codes are dispatched correctly + d: closes. The handler
 * itself is exercised end-to-end via the Phase 6 Next.js example.
 */

function makeStream(records: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`${records.join("\n")}\n`));
      controller.close();
    },
  });
}

describe("streamAssistant wire format (o: / O: codes)", () => {
  it("dispatches o: payloads to onPartialObject with partial + attempt", async () => {
    const partials: { partial: unknown; attempt: number }[] = [];
    await consumeDataStream(
      makeStream([
        `o:${JSON.stringify({ partial: { title: "h" }, attempt: 1 })}`,
        `o:${JSON.stringify({ partial: { title: "hello" }, attempt: 2 })}`,
        `d:{}`,
      ]),
      { onPartialObject: (p) => partials.push(p) },
    );
    expect(partials).toHaveLength(2);
    expect(partials[0]).toEqual({ partial: { title: "h" }, attempt: 1 });
    expect(partials[1]).toEqual({ partial: { title: "hello" }, attempt: 2 });
  });

  it("dispatches O: payload to onCompleteObject", async () => {
    let received: unknown;
    await consumeDataStream(
      makeStream([
        `o:${JSON.stringify({ partial: { x: 1 }, attempt: 1 })}`,
        `O:${JSON.stringify({ object: { x: 1, y: 2 } })}`,
        `d:{}`,
      ]),
      { onCompleteObject: (p) => (received = p.object) },
    );
    expect(received).toEqual({ x: 1, y: 2 });
  });

  it("ordering: o: events precede O: which precedes d:", async () => {
    const log: string[] = [];
    await consumeDataStream(
      makeStream([
        `o:${JSON.stringify({ partial: {}, attempt: 1 })}`,
        `O:${JSON.stringify({ object: { final: true } })}`,
        `d:${JSON.stringify({ finishReason: "stop" })}`,
      ]),
      {
        onPartialObject: () => log.push("partial"),
        onCompleteObject: () => log.push("complete"),
        onFinish: () => log.push("finish"),
      },
    );
    expect(log).toEqual(["partial", "complete", "finish"]);
  });

  it("EC-11: useTheoChat consumer (no o:/O: handlers) ignores object codes", async () => {
    // Simulate useTheoChat consumer: only onText handler.
    const texts: string[] = [];
    let threw = false;
    try {
      await consumeDataStream(
        makeStream([
          `0:${JSON.stringify("hello")}`,
          `o:${JSON.stringify({ partial: { x: 1 }, attempt: 1 })}`,
          `O:${JSON.stringify({ object: { x: 1 } })}`,
          `d:{}`,
        ]),
        { onText: (d) => texts.push(d) },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(texts).toEqual(["hello"]);
  });
});
