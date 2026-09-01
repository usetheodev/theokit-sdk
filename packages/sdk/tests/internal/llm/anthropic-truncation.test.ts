/**
 * M2 #61 (adversarial-review gap) — the Anthropic streaming client had no
 * truncation guard: a stream that closes cleanly-but-early (server FIN before
 * the `message_delta` carrying `stop_reason`) was silently committed as a clean
 * `end_turn`. It must throw a typed `stream_truncated` NetworkError, matching the
 * OpenAI client.
 */
import { describe, expect, it } from "vitest";
import { NetworkError } from "../../../src/errors.js";
import { AnthropicClient } from "../../../src/internal/llm/anthropic.js";
import type { LlmFinish } from "../../../src/internal/llm/types.js";
import { messageDelta, textDelta } from "../../helpers/anthropic-sse.js";

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
  const client = new AnthropicClient({
    apiKey: "sk-ant-test",
    fetch: async () => sseResponse(frames),
  });
  const gen = client.stream(
    {
      model: "claude-3-5-haiku",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    },
    new AbortController().signal,
  );
  while (true) {
    const n = await gen.next();
    if (n.done === true) return n.value;
  }
}

describe("M2 #61 — Anthropic truncation detection", () => {
  it("throws stream_truncated when the stream ends without a stop_reason", async () => {
    const frames = [textDelta("partial answer")]; // no message_delta → truncated
    await expect(runStream(frames)).rejects.toBeInstanceOf(NetworkError);
    await expect(runStream(frames)).rejects.toMatchObject({ code: "stream_truncated" });
  });

  it("completes normally when a message_delta stop_reason is present", async () => {
    const finish = await runStream([
      textDelta("done"),
      messageDelta("end_turn", { output_tokens: 3 }),
    ]);
    expect(finish.stopReason).toBe("end_turn");
    expect(finish.text).toBe("done");
  });
});
