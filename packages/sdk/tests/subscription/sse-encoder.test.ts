/**
 * G8 T1.3 — W3C SSE encoder.
 */
import { describe, expect, it } from "vitest";
import { encodeSseChunk } from "../../src/subscription/internal/sse-encoder.js";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("encodeSseChunk", () => {
  it("encodes event + data + id with double-newline terminator", () => {
    const out = decode(encodeSseChunk({ event: "message", data: "hello", id: "ev-1" }));
    expect(out).toBe("event: message\nid: ev-1\ndata: hello\n\n");
  });

  it("encodes data-only event with default behavior", () => {
    const out = decode(encodeSseChunk({ data: "ping" }));
    expect(out).toBe("data: ping\n\n");
  });

  it("encodes multi-line data as multiple data: lines", () => {
    const out = decode(encodeSseChunk({ data: "line1\nline2\nline3" }));
    expect(out).toBe("data: line1\ndata: line2\ndata: line3\n\n");
  });

  it("encodes retry hint as integer ms", () => {
    const out = decode(encodeSseChunk({ retry: 5000 }));
    expect(out).toBe("retry: 5000\n\n");
  });

  it("encodes comment as : prefix", () => {
    const out = decode(encodeSseChunk({ comment: "keepalive" }));
    expect(out).toBe(": keepalive\n\n");
  });

  it("emits blank-line-only terminator for empty event", () => {
    const out = decode(encodeSseChunk({}));
    expect(out).toBe("\n\n");
  });

  it("throws on newline in event name", () => {
    expect(() => encodeSseChunk({ event: "bad\nname" })).toThrow(TypeError);
  });

  it("throws on newline in id", () => {
    expect(() => encodeSseChunk({ id: "bad\nid" })).toThrow(TypeError);
  });

  it("throws on non-integer retry", () => {
    expect(() => encodeSseChunk({ retry: 1.5 })).toThrow(TypeError);
    expect(() => encodeSseChunk({ retry: -1 })).toThrow(TypeError);
  });
});
