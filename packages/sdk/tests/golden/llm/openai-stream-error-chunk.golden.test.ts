import { describe, expect, it } from "vitest";

import { AuthenticationError, RateLimitError } from "../../../src/errors.js";
import { OpenAIClient } from "../../../src/internal/llm/openai.js";

/**
 * Regression: usetheodev/theocode#31 — a provider that streams an error object
 * with HTTP 200 (OpenRouter's shape for auth / quota / rate-limit failures:
 * `data: {"error":{"message":"User not found.","code":401}}`) was silently
 * swallowed. The accumulator only reads `chunk.choices`, so an error-only chunk
 * produced ZERO events and the round finished empty (`terminal: stop`) — no text,
 * no throw. The agent loop then surfaced nothing to the user. Fail-loud requires
 * the in-stream error to throw a typed error, exactly like a non-2xx HTTP status.
 */
function sseStream(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function drain(gen: AsyncGenerator<unknown, unknown, void>): Promise<void> {
  for await (const _ of gen) {
    // exhaust the stream
  }
}

describe("OpenAI client — in-stream provider error (HTTP 200 + data:{error})", () => {
  it("throws a typed AuthenticationError on a 401 error chunk (OpenRouter-in-body)", async () => {
    const frames = [
      'data: {"error":{"message":"User not found.","code":401}}\n\n',
      "data: [DONE]\n\n",
    ];
    const client = new OpenAIClient({ apiKey: "sk-test", fetch: async () => sseStream(frames) });
    const gen = client.stream(
      {
        model: "deepseek/deepseek-r1",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      },
      new AbortController().signal,
    );
    await expect(drain(gen)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("throws a typed RateLimitError on a 429 error chunk", async () => {
    const frames = [
      'data: {"error":{"message":"rate limited","code":429}}\n\n',
      "data: [DONE]\n\n",
    ];
    const client = new OpenAIClient({ apiKey: "sk-test", fetch: async () => sseStream(frames) });
    const gen = client.stream(
      {
        model: "deepseek/deepseek-r1",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      },
      new AbortController().signal,
    );
    await expect(drain(gen)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("still emits content normally when no error chunk is present", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const client = new OpenAIClient({ apiKey: "sk-test", fetch: async () => sseStream(frames) });
    const texts: string[] = [];
    const gen = client.stream(
      {
        model: "deepseek/deepseek-r1",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      },
      new AbortController().signal,
    );
    for await (const ev of gen) {
      if (ev.type === "text_delta") texts.push(ev.text);
    }
    expect(texts.join("")).toBe("ok");
  });
});
