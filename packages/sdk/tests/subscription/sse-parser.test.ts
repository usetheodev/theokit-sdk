/**
 * G8 T1.3 — W3C SSE parser.
 */
import { describe, expect, it } from "vitest";
import { encodeSseChunk } from "../../src/subscription/internal/sse-encoder.js";
import { parseSseW3C } from "../../src/subscription/internal/sse-parser.js";

async function* toBytes(...chunks: Uint8Array[]) {
  for (const c of chunks) yield c;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("parseSseW3C", () => {
  it("round-trips event + data + id through encoder", async () => {
    const bytes = encodeSseChunk({ event: "message", data: "hello", id: "ev-1" });
    const events = await collect(parseSseW3C(toBytes(bytes)));
    expect(events).toEqual([{ event: "message", data: "hello", id: "ev-1" }]);
  });

  it("round-trips multi-line data", async () => {
    const bytes = encodeSseChunk({ data: "line1\nline2" });
    const events = await collect(parseSseW3C(toBytes(bytes)));
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe("line1\nline2");
  });

  it("preserves id across reconnect (Last-Event-ID source)", async () => {
    const a = encodeSseChunk({ event: "msg", data: "1", id: "a" });
    const b = encodeSseChunk({ event: "msg", data: "2", id: "b" });
    const events = await collect(parseSseW3C(toBytes(a, b)));
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("ignores comment-only events but surfaces comment content", async () => {
    const bytes = encodeSseChunk({ comment: "keepalive" });
    const events = await collect(parseSseW3C(toBytes(bytes)));
    expect(events).toHaveLength(1);
    expect(events[0]?.comment).toBe("keepalive");
  });

  it("does NOT dispatch on blank line with no preceding fields", async () => {
    const events = await collect(parseSseW3C(toBytes(new TextEncoder().encode("\n\n"))));
    expect(events).toEqual([]);
  });

  it("ignores unknown fields per spec", async () => {
    const raw = "event: msg\ndata: ok\nunknown: ignored\n\n";
    const events = await collect(parseSseW3C(toBytes(new TextEncoder().encode(raw))));
    expect(events).toEqual([{ event: "msg", data: "ok" }]);
  });

  it("normalizes CRLF + CR line endings", async () => {
    const raw = "event: msg\r\ndata: a\rdata: b\r\n\r\n";
    const events = await collect(parseSseW3C(toBytes(new TextEncoder().encode(raw))));
    expect(events).toEqual([{ event: "msg", data: "a\nb" }]);
  });
});
