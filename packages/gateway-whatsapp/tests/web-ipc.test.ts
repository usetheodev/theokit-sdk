/**
 * IPC protocol tests (T3.2 + EC-11).
 */

import { describe, expect, it } from "vitest";

import { formatCommand, LineBuffer, parseEvent } from "../src/backend/web/ipc.js";

describe("parseEvent", () => {
  it("test_parse_event_message — valid JSON line", () => {
    const e = parseEvent(
      '{"event":"message","msgId":"x","from":"5511","body":"hi","isGroup":false,"chatId":"5511","timestamp":1700}',
    );
    expect(e).not.toBeNull();
    expect(e?.event).toBe("message");
  });

  it("test_parse_event_malformed_returns_null", () => {
    expect(parseEvent("not json {")).toBeNull();
    expect(parseEvent("")).toBeNull();
    expect(parseEvent("null")).toBeNull();
    expect(parseEvent('"string"')).toBeNull();
    expect(parseEvent('{"no_event_field":1}')).toBeNull();
  });
});

describe("formatCommand", () => {
  it("test_format_command_adds_newline", () => {
    const out = formatCommand({ cmd: "shutdown" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.slice(0, -1)).toBe('{"cmd":"shutdown"}');
  });

  it("serializes send command", () => {
    const out = formatCommand({ cmd: "send", msgId: "x", to: "5511", text: "hi" });
    expect(JSON.parse(out)).toEqual({ cmd: "send", msgId: "x", to: "5511", text: "hi" });
  });
});

describe("LineBuffer (EC-11)", () => {
  it("test_ipc_buffers_fragmented_line — chunked stdout reads", () => {
    const buf = new LineBuffer();
    expect(buf.push('{"event":"mes')).toEqual([]);
    expect(buf.pending).toBe('{"event":"mes');
    const lines = buf.push('sage","msgId":"x","from":"5511","body":"hi","isGroup":false,"chatId":"5511","timestamp":1}\n');
    expect(lines).toHaveLength(1);
    expect(parseEvent(lines[0]!)?.event).toBe("message");
    expect(buf.pending).toBe("");
  });

  it("yields multiple lines from one chunk", () => {
    const buf = new LineBuffer();
    const lines = buf.push('{"event":"ready","botPhone":"5511"}\n{"event":"error","message":"x"}\n');
    expect(lines).toHaveLength(2);
  });

  it("keeps trailing partial in buffer", () => {
    const buf = new LineBuffer();
    const lines = buf.push('{"event":"ready","botPhone":"5511"}\n{"event":"err');
    expect(lines).toHaveLength(1);
    expect(buf.pending).toBe('{"event":"err');
  });
});
