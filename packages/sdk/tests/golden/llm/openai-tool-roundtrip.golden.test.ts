import { describe, expect, it } from "vitest";

import { OpenAIClient } from "../../../src/internal/llm/openai.js";

/**
 * Regression for the OpenAI request body shape after a tool_use turn:
 * tool_result parts must be emitted as `role: "tool"` messages with a
 * matching `tool_call_id`, not collapsed into a `user` message.
 *
 * Without this, OpenRouter / OpenAI reject the follow-up call with
 * "An assistant message with 'tool_calls' must be followed by tool
 *  messages responding to each tool_call_id".
 */

describe("OpenAI client tool roundtrip body", () => {
  it("emits tool messages with matching tool_call_id after an assistant tool_use turn", async () => {
    const captured: { body: unknown } = { body: undefined };
    const stubFetch: typeof fetch = async (_input, init) => {
      captured.body = JSON.parse((init?.body as string) ?? "{}");
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
            ),
          );
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const client = new OpenAIClient({ apiKey: "sk-stub", fetch: stubFetch });

    const generator = client.stream(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: [{ type: "text", text: "Run shell." }] },
          {
            role: "assistant",
            content: [
              { type: "text", text: "Let me run it." },
              {
                type: "tool_use",
                id: "call_abc",
                name: "shell",
                input: { command: "cat secret.txt" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                toolUseId: "call_abc",
                content: "answer-is-42",
              },
            ],
          },
        ],
        tools: [
          { name: "shell", description: "Run a shell command", inputSchema: { type: "object" } },
        ],
      },
      new AbortController().signal,
    );
    // Drain the generator so the request fires.
    for await (const _event of generator) {
      // no-op
    }

    expect(captured.body).toBeDefined();
    const body = captured.body as { messages: Array<Record<string, unknown>> };
    const assistantIndex = body.messages.findIndex((m) => m.role === "assistant");
    const toolIndex = body.messages.findIndex((m) => m.role === "tool");
    expect(assistantIndex).toBeGreaterThan(-1);
    expect(toolIndex).toBeGreaterThan(-1);
    expect(toolIndex).toBeGreaterThan(assistantIndex);
    const toolMessage = body.messages[toolIndex];
    expect(toolMessage?.tool_call_id).toBe("call_abc");
    expect(toolMessage?.content).toBe("answer-is-42");
  });
});
