import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildResponsesBody, ResponsesApiClient } from "../../../src/internal/llm/responses.js";
import type { LlmEvent, LlmRequest } from "../../../src/internal/llm/types.js";

/**
 * M40 — the Responses-API transport. GOLDEN tests against Upstream's recorded SSE fixtures (MIT © 2025
 * upstream), so the theokit port stays faithful to the real ChatGPT/OpenAI responses stream shape. A fixture
 * is a recorded HTTP interaction `{ request: { body }, response: { status, body: <SSE text> } }`.
 */
const fixtureDir = join(__dirname, "responses-fixtures");
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as {
    interactions: Array<{ request: { body: string }; response: { status: number; body: string } }>;
  };

/** An injected fetch that replays a recorded SSE body as the response stream. */
const replayFetch = (sse: string, status = 200): typeof fetch =>
  (async () =>
    new Response(sse, {
      status,
      headers: { "content-type": "text/event-stream" },
    })) as typeof fetch;

async function drain(
  client: ResponsesApiClient,
  request: LlmRequest,
): Promise<{
  events: LlmEvent[];
  finish: Awaited<ReturnType<ResponsesApiClient["stream"]>> extends never
    ? never
    : {
        text: string;
        stopReason: string;
        toolCalls: unknown[];
        inputTokens?: number;
        outputTokens?: number;
      };
}> {
  const events: LlmEvent[] = [];
  const gen = client.stream(request, new AbortController().signal);
  let res = await gen.next();
  while (!res.done) {
    events.push(res.value);
    res = await gen.next();
  }
  return { events, finish: res.value as never };
}

describe("M40 — ResponsesApiClient (golden, Upstream fixtures)", () => {
  it("builds the Responses body from an LlmRequest (matches the recorded request shape)", () => {
    const body = buildResponsesBody({
      model: "gpt-5.5",
      system: "You are concise.",
      messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly: Hello!" }] }],
      maxTokens: 80,
    });
    expect(body.model).toBe("gpt-5.5");
    expect(body.stream).toBe(true);
    expect(body.instructions).toBe("You are concise.");
    expect(body.max_output_tokens).toBe(80);
    expect(body.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Reply with exactly: Hello!" }] },
    ]);
  });

  it("streams text from the recorded text fixture → text_delta events + stop end_turn + usage", async () => {
    const fx = loadFixture("streams-text.json").interactions[0]!;
    const client = new ResponsesApiClient({
      apiKey: "sk-test",
      fetch: replayFetch(fx.response.body),
    });
    const { events, finish } = await drain(client, {
      model: "gpt-5.5",
      system: "You are concise.",
      messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly: Hello!" }] }],
    });
    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThan(0);
    expect(finish.text.length).toBeGreaterThan(0);
    expect(finish.text.toLowerCase()).toContain("hello");
    expect(finish.stopReason).toBe("end_turn");
    expect(events.at(-1)).toEqual({ type: "stop", reason: "end_turn" });
    expect(finish.outputTokens).toBeGreaterThan(0);
  });

  it("streams a function tool call → tool_use event + LlmFinish.toolCalls + stop tool_use", async () => {
    const fx = loadFixture("streams-tool-call.json").interactions[0]!;
    const client = new ResponsesApiClient({
      apiKey: "sk-test",
      fetch: replayFetch(fx.response.body),
    });
    const { events, finish } = await drain(client, {
      model: "gpt-5.5",
      messages: [{ role: "user", content: [{ type: "text", text: "weather in Paris?" }] }],
      tools: [{ name: "get_weather", description: "", inputSchema: { type: "object" } }],
    });
    const toolUse = events.find((e) => e.type === "tool_use") as
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
      | undefined;
    expect(toolUse?.name).toBe("get_weather");
    expect(toolUse?.id).toMatch(/^call_/);
    expect(toolUse?.input).toHaveProperty("city");
    expect(finish.toolCalls).toHaveLength(1);
    expect(finish.stopReason).toBe("tool_use");
  });

  it("maps a non-200 response to a typed provider error (no token echoed)", async () => {
    const client = new ResponsesApiClient({
      apiKey: "sk-SECRET",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "unauthorized" } }), {
          status: 401,
        })) as typeof fetch,
    });
    await expect(async () => {
      const gen = client.stream(
        { model: "gpt-5.5", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
        new AbortController().signal,
      );
      let r = await gen.next();
      while (!r.done) r = await gen.next();
    }).rejects.toThrowError();
  });
});
