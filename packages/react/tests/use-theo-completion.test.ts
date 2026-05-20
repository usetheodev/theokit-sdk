import { describe, expect, it } from "vitest";

import { consumeDataStream } from "../src/internal/sse-parser.js";

/**
 * Parser tests for the shared SSE consumer used by useTheoCompletion.
 * Hook lifecycle (render + state) is exercised via the Next.js example
 * in Phase 6; here we test the wire-format invariants that the hook
 * relies on.
 *
 * Covers EC-11: forward-compat unknown codes ignored silently.
 */

function makeStream(records: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const body = `${records.join("\n")}\n`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(body));
      controller.close();
    },
  });
}

describe("consumeDataStream (shared SSE parser)", () => {
  it("appends text deltas via onText callback", async () => {
    const accumulator: string[] = [];
    await consumeDataStream(
      makeStream([
        `0:${JSON.stringify("foo")}`,
        `0:${JSON.stringify(" bar")}`,
        `d:{"finishReason":"stop"}`,
      ]),
      {
        onText: (delta) => accumulator.push(delta),
      },
    );
    expect(accumulator.join("")).toBe("foo bar");
  });

  it("invokes onFinish for d: code", async () => {
    let finishedWith: unknown;
    await consumeDataStream(
      makeStream([
        `0:${JSON.stringify("x")}`,
        `d:{"finishReason":"stop","usage":{"inputTokens":3}}`,
      ]),
      {
        onText: () => {},
        onFinish: (p) => {
          finishedWith = p;
        },
      },
    );
    expect(finishedWith).toEqual({ finishReason: "stop", usage: { inputTokens: 3 } });
  });

  it("invokes onError and throws for 3: code", async () => {
    let errorMsg = "";
    await expect(
      consumeDataStream(
        makeStream([`0:${JSON.stringify("start")}`, `3:${JSON.stringify("rate_limit")}`]),
        {
          onText: () => {},
          onError: (msg) => {
            errorMsg = msg;
          },
        },
      ),
    ).rejects.toThrow("rate_limit");
    expect(errorMsg).toBe("rate_limit");
  });

  it("EC-11: ignores unknown codes silently (forward-compat)", async () => {
    const texts: string[] = [];
    await consumeDataStream(
      makeStream([
        `x:${JSON.stringify("future-extension-1")}`,
        `0:${JSON.stringify("real-text")}`,
        `Z:${JSON.stringify({ future: "code" })}`,
        `d:{"finishReason":"stop"}`,
      ]),
      {
        onText: (d) => texts.push(d),
      },
    );
    // Unknown codes did not throw. Real text was processed.
    expect(texts).toEqual(["real-text"]);
  });

  it("handles SSE records split across chunks", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Split a single record across two chunks.
        controller.enqueue(enc.encode(`0:"foo`));
        controller.enqueue(enc.encode(`bar"\n`));
        controller.enqueue(enc.encode(`d:{}\n`));
        controller.close();
      },
    });
    const texts: string[] = [];
    await consumeDataStream(stream, { onText: (d) => texts.push(d) });
    expect(texts).toEqual(["foobar"]);
  });

  it("ignores malformed JSON payloads gracefully", async () => {
    const texts: string[] = [];
    await consumeDataStream(
      makeStream([
        `0:not-json-here`, // malformed
        `0:${JSON.stringify("valid")}`,
        `d:{}`,
      ]),
      { onText: (d) => texts.push(d) },
    );
    expect(texts).toEqual(["valid"]);
  });

  it("returns normally on graceful EOF without d: event (EC-8 equivalent)", async () => {
    const texts: string[] = [];
    await consumeDataStream(makeStream([`0:${JSON.stringify("only-text")}`]), {
      onText: (d) => texts.push(d),
    });
    expect(texts).toEqual(["only-text"]);
  });
});
