/**
 * M2 #61 (T2.2) — RED-first: an OpenAI stream that ends with NEITHER a
 * finish_reason NOR a [DONE] sentinel was truncated (dropped connection /
 * proxy hiccup). It must throw a typed stream_truncated NetworkError instead
 * of silently committing the partial turn as a clean end_turn.
 */
import { describe, expect, it } from "vitest";
import { NetworkError } from "../../../src/errors.js";
import { OpenAIClient } from "../../../src/internal/llm/openai.js";
import type { LlmFinish } from "../../../src/internal/llm/types.js";

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function runStream(frames: string[]): Promise<LlmFinish> {
  const client = new OpenAIClient({ apiKey: "sk-test", fetch: async () => sseResponse(frames) });
  const gen = client.stream(
    { model: "gpt-4o-mini", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
    new AbortController().signal,
  );
  while (true) {
    const n = await gen.next();
    if (n.done === true) return n.value;
  }
}

describe("M2 #61 — OpenAI truncation detection", () => {
  it("throws stream_truncated when the stream ends without finish_reason or [DONE]", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"partial answer"}}]}\n\n',
      // stream ends here — no finish_reason chunk, no [DONE] sentinel
    ];
    await expect(runStream(frames)).rejects.toBeInstanceOf(NetworkError);
    await expect(runStream(frames)).rejects.toMatchObject({ code: "stream_truncated" });
  });

  it("completes normally when a finish_reason is present (no [DONE])", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n',
    ];
    const finish = await runStream(frames);
    expect(finish.stopReason).toBe("end_turn");
    expect(finish.text).toBe("done");
  });

  it("completes normally when [DONE] is present (no finish_reason)", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const finish = await runStream(frames);
    expect(finish.text).toBe("hi");
  });
});
