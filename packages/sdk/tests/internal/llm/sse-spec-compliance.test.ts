/**
 * T3.1 — SSE parser MUST comply with HTML Living Standard § 9.2.6
 * ("Server-sent events / dispatchEvent" — specifically the
 * "Process the field" step that handles `field` / `value` extraction).
 *
 * The spec says:
 *   > If the value of field starts with a U+0020 SPACE character,
 *   > remove it from value.
 *
 * Pre-T3.1, the parser called `.trim()` on the value, which:
 *  - strips ALL leading whitespace (spec wants only ONE leading space)
 *  - strips trailing whitespace including legitimate whitespace in the
 *    payload (e.g., a JSON string ending in `" \n"`)
 *  - destroys binary-safe round-trip when providers stream chunked JSON
 *    that legitimately contains spaces at the edges.
 *
 * This is the root cause of intermittent stream truncation observed in
 * the DR3 review finding #1. Fix: replace `.trim()` with a single-leading-
 * space strip (`startsWith(" ") ? slice(1) : value`).
 */

import { describe, expect, it } from "vitest";

import { parseSseStream } from "../../../src/internal/llm/sse.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i] ?? ""));
      i += 1;
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>) {
  const out: Array<{ event: string; data: string }> = [];
  for await (const r of parseSseStream(stream, new AbortController().signal)) {
    out.push(r);
  }
  return out;
}

describe("T3.1 — SSE parser HTML LS §9.2.6 compliance", () => {
  it("strips exactly ONE leading space after 'data:' (not all whitespace)", async () => {
    // 2 spaces after the colon — only 1 should be stripped.
    const records = await drain(streamOf(["data:  hello\n\n"]));
    expect(records).toHaveLength(1);
    expect(records[0]?.data).toBe(" hello"); // 1 leading space preserved
  });

  it("preserves trailing whitespace in data payload", async () => {
    const records = await drain(streamOf(["data: hello world  \n\n"]));
    expect(records).toHaveLength(1);
    // Pre-T3.1 trim() stripped the trailing 2 spaces. T3.1 keeps them.
    expect(records[0]?.data).toBe("hello world  ");
  });

  it("handles 'data:' with NO leading space (no strip)", async () => {
    const records = await drain(streamOf(["data:hello\n\n"]));
    expect(records).toHaveLength(1);
    expect(records[0]?.data).toBe("hello");
  });

  it("preserves whitespace inside multi-line data payloads", async () => {
    // Two data lines joined with '\n' per spec; each is parsed independently.
    const records = await drain(streamOf(["data:  line1\ndata: line2\n\n"]));
    expect(records).toHaveLength(1);
    expect(records[0]?.data).toBe(" line1\nline2");
  });

  it("preserves whitespace in event names too (single-space strip)", async () => {
    const records = await drain(streamOf(["event:  message_start\ndata: hello\n\n"]));
    expect(records).toHaveLength(1);
    expect(records[0]?.event).toBe(" message_start");
  });

  it("does NOT strip newlines from a chunked payload spanning multiple chunks", async () => {
    // Realistic Anthropic-style streaming: one chunk delivers part of the
    // event, another delivers the rest. The buffer must preserve internal
    // whitespace across chunk boundaries.
    const records = await drain(streamOf(["data: {", '"text": "  padded  "}\n\n']));
    expect(records).toHaveLength(1);
    const parsed = JSON.parse(records[0]?.data ?? "");
    expect(parsed.text).toBe("  padded  ");
  });
});
