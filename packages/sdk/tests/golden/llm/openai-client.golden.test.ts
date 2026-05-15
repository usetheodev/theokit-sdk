import { describe, expect, it } from "vitest";

import { OpenAIClient } from "../../../src/internal/llm/openai.js";

/**
 * Behaviour gate for the real OpenAI Chat Completions streaming client.
 * Uses a stub `fetch` that emits canned SSE frames.
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

describe("real OpenAI client", () => {
  it("translates content/tool_calls deltas into provider-agnostic events", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shell","arguments":"{\\"cmd\\":\\"ls\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":11,"completion_tokens":4}}\n\n',
      "data: [DONE]\n\n",
    ];
    const stubFetch: typeof fetch = async () => sseStream(frames);
    const client = new OpenAIClient({ apiKey: "sk-test", fetch: stubFetch });

    const controller = new AbortController();
    const texts: string[] = [];
    const generator = client.stream(
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [{ name: "shell", description: "Run shell", inputSchema: { type: "object" } }],
      },
      controller.signal,
    );

    let result: Awaited<ReturnType<typeof client.stream>> extends AsyncGenerator<
      unknown,
      infer R,
      unknown
    >
      ? R
      : never;
    while (true) {
      const next = await generator.next();
      if (next.done === true) {
        result = next.value;
        break;
      }
      if (next.value.type === "text_delta") texts.push(next.value.text);
    }
    expect(texts.join("")).toBe("Hello world");
    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("shell");
    expect(result.toolCalls[0]?.input).toEqual({ cmd: "ls" });
    expect(result.inputTokens).toBe(11);
    expect(result.outputTokens).toBe(4);
  });
});
