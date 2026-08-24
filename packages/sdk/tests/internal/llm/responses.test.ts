import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AuthenticationError } from "../../../src/errors.js";
import { buildResponsesBody, ResponsesApiClient } from "../../../src/internal/llm/responses.js";
import type { LlmEvent, LlmRequest, LlmToolCallPart } from "../../../src/internal/llm/types.js";

/**
 * M40 — the Responses-API transport. GOLDEN tests against recorded SSE fixtures,
 * so the transport stays faithful to the real ChatGPT/OpenAI responses stream shape. A fixture
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
        // theokit#144: typed rather than `unknown[]` — with the `tool_use` event gone, the finish
        // value is the only place a tool call is reported, so the test must be able to read it.
        toolCalls: LlmToolCallPart[];
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

describe("M40 — ResponsesApiClient (golden SSE fixtures)", () => {
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

  it("strips a provider prefix from the model (defense-in-depth: the backend wants a bare model id)", () => {
    const body = buildResponsesBody({
      model: "openai-chatgpt/gpt-5.4",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(body.model).toBe("gpt-5.4");
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
    // theokit#144: the stop reason is reported once, on the finish value (asserted above). It used
    // to be echoed as a trailing `stop` event that no consumer read; the stream now ends with the
    // last text delta.
    expect(events.at(-1)?.type).toBe("text_delta");
    expect(finish.outputTokens).toBeGreaterThan(0);
  });

  // theokit#144: this asserted a `tool_use` EVENT alongside the finish value. The event had no
  // consumer anywhere in the SDK and duplicated `finish.toolCalls`, so it is gone; the assertions
  // moved onto the surviving contract, which is also the one the agent loop actually reads. The
  // streamed `response.function_call_arguments.delta` chunks are still exercised — the parsed
  // `input` below can only be right if they were accumulated.
  it("accumulates a streamed function tool call onto LlmFinish.toolCalls + stop tool_use", async () => {
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
    expect(finish.toolCalls).toHaveLength(1);
    const call = finish.toolCalls[0];
    expect(call?.name).toBe("get_weather");
    expect(call?.id).toMatch(/^call_/);
    expect(call?.input).toHaveProperty("city");
    expect(finish.stopReason).toBe("tool_use");
    // The stream reports text and reasoning only — a tool call is never an in-stream event.
    expect(events.every((e) => e.type !== "error")).toBe(true);
  });

  it("maps a non-200 response to a typed provider error (no token echoed)", async () => {
    const client = new ResponsesApiClient({
      apiKey: "sk-SECRET",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "unauthorized" } }), {
          status: 401,
        })) as typeof fetch,
    });
    // B-079 — was bare `.rejects.toThrowError()`, ironic given the test's own
    // name ("...to a typed provider error"): `mapOpenAICompatibleError` maps
    // 401 → typed `AuthenticationError` (openai-compatible.ts:51) with code
    // `openai_auth_failed`; only the assertion was not pinning it.
    const drainStream = async (): Promise<void> => {
      const gen = client.stream(
        { model: "gpt-5.5", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
        new AbortController().signal,
      );
      let r = await gen.next();
      while (!r.done) r = await gen.next();
    };
    await expect(drainStream()).rejects.toThrow(AuthenticationError);
    await expect(drainStream()).rejects.toMatchObject({ code: "openai_auth_failed" });
  });
});
