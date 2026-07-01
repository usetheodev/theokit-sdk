import { describe, expect, it } from "vitest";

import { OpenAIClient } from "../../../src/internal/llm/openai.js";
import type { LlmEvent, LlmFinish } from "../../../src/internal/llm/types.js";

/**
 * End-to-end evidence (theokit#58 follow-up — leaked-dialect safe-parse).
 *
 * Some models (qwen3-coder via OpenRouter, OpenAI-compatible API) intermittently emit their Hermes
 * tool-call dialect as assistant TEXT content instead of native `tool_calls`:
 *
 *   <function=NAME><parameter=KEY>VALUE</parameter></function></tool_call>
 *
 * With ZERO native tool_calls the agent loop sees an `end_turn` with no tools and the intended call
 * is silently lost. These golden tests exercise the FULL client path — real SSE body → `parseSseStream`
 * → `OpenAIStreamAccumulator` → `finish()` — proving the opt-in `extractToolCallsFromContent` flag
 * (threaded through `OpenAIClientOptions`) recovers the call so the loop can execute it, while the
 * default-off path preserves the existing behavior exactly.
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

/** Drain the generator, returning both the streamed events and the terminal `LlmFinish`. */
async function collect(
  gen: AsyncGenerator<LlmEvent, LlmFinish, void>,
): Promise<{ events: LlmEvent[]; finish: LlmFinish }> {
  const events: LlmEvent[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, finish: step.value };
}

const TOOL = (name: string) => ({ name, description: name, inputSchema: { type: "object" } });

// R5: recovery is request-scoped — the request MUST declare the tools whose leaked blocks it expects
// to recover (`shell_exec`, `read_file`). A leaked name absent from `tools` is NOT promoted.
const REQUEST = {
  model: "qwen/qwen3-coder",
  messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "run it" }] }],
  tools: [TOOL("shell_exec"), TOOL("read_file")],
};

describe("OpenAI client — leaked-dialect safe-parse (full SSE → finish path)", () => {
  it("flag OFF: a leaked Hermes block stays text, no tool_calls (bug state preserved)", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"<function=shell_exec><parameter=command>echo hi"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"</parameter></function></tool_call>"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const client = new OpenAIClient({ apiKey: "sk-test", fetch: async () => sseStream(frames) });
    const { finish } = await collect(client.stream(REQUEST, new AbortController().signal));
    expect(finish.toolCalls).toHaveLength(0);
    expect(finish.stopReason).toBe("end_turn");
    expect(finish.text).toContain("<function=");
  });

  it("flag ON: a leaked Hermes block (split across chunks) is recovered as a real tool_call", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"<function=shell_exec><parameter=command>echo hi"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"</parameter></function></tool_call>"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const client = new OpenAIClient({
      apiKey: "sk-test",
      extractToolCallsFromContent: true,
      fetch: async () => sseStream(frames),
    });
    const { finish } = await collect(client.stream(REQUEST, new AbortController().signal));
    expect(finish.toolCalls).toHaveLength(1);
    expect(finish.toolCalls[0]?.name).toBe("shell_exec");
    expect(finish.toolCalls[0]?.input).toEqual({ command: "echo hi" });
    expect(finish.toolCalls[0]?.id).toMatch(/^hermes-/);
    // The loop gate at loop.ts keys on stopReason === "tool_use" — the flip is what makes it dispatch.
    expect(finish.stopReason).toBe("tool_use");
    expect(finish.text).not.toContain("<function=");
  });

  it("flag ON: multiple leaked blocks in one turn are all recovered", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"I will run two commands. "}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"<function=shell_exec><parameter=command>ls</parameter></function></tool_call>"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"<function=read_file><parameter=path>/tmp/x</parameter></function></tool_call>"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const client = new OpenAIClient({
      apiKey: "sk-test",
      extractToolCallsFromContent: true,
      fetch: async () => sseStream(frames),
    });
    const { finish } = await collect(client.stream(REQUEST, new AbortController().signal));
    expect(finish.toolCalls).toHaveLength(2);
    expect(finish.toolCalls.map((c) => c.name)).toEqual(["shell_exec", "read_file"]);
    expect(finish.toolCalls[1]?.input).toEqual({ path: "/tmp/x" });
    expect(finish.stopReason).toBe("tool_use");
    expect(finish.text).toContain("I will run two commands.");
  });

  it("flag ON: native tool_calls win — a co-occurring leaked block is NOT double-counted", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_native","function":{"name":"real_tool","arguments":"{\\"a\\":1}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"<function=shell_exec><parameter=command>echo hi</parameter></function></tool_call>"},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const client = new OpenAIClient({
      apiKey: "sk-test",
      extractToolCallsFromContent: true,
      fetch: async () => sseStream(frames),
    });
    const { finish } = await collect(client.stream(REQUEST, new AbortController().signal));
    expect(finish.toolCalls).toHaveLength(1);
    expect(finish.toolCalls[0]?.name).toBe("real_tool");
    expect(finish.toolCalls[0]?.id).toBe("call_native");
  });

  it("flag ON: a plain answer with no dialect stays plain text, no tool_calls", async () => {
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"just a normal answer"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const client = new OpenAIClient({
      apiKey: "sk-test",
      extractToolCallsFromContent: true,
      fetch: async () => sseStream(frames),
    });
    const { finish } = await collect(client.stream(REQUEST, new AbortController().signal));
    expect(finish.toolCalls).toHaveLength(0);
    expect(finish.stopReason).toBe("end_turn");
    expect(finish.text).toBe("just a normal answer");
  });

  const LEAK_FRAMES = [
    'data: {"choices":[{"index":0,"delta":{"content":"<function=shell_exec><parameter=command>echo hi"}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"content":"</parameter></function></tool_call>"},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ];

  it("test_flag_on_leaked_name_not_in_request_tools_is_not_recovered (R5)", async () => {
    // The route leaks a `shell_exec` call, but the request declares only `other_tool` — request-scoped
    // matching drops it (it is not a tool the model was given), leaving the text visible.
    const request = {
      model: "qwen/qwen3-coder",
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "x" }] }],
      tools: [TOOL("other_tool")],
    };
    const client = new OpenAIClient({
      apiKey: "sk-test",
      extractToolCallsFromContent: true,
      fetch: async () => sseStream(LEAK_FRAMES),
    });
    const { finish } = await collect(client.stream(request, new AbortController().signal));
    expect(finish.toolCalls).toHaveLength(0);
    expect(finish.stopReason).toBe("end_turn");
    expect(finish.text).toContain("<function=");
  });

  it("test_flag_on_empty_request_tools_recovers_nothing (R5)", async () => {
    // A request with no tools has nothing legitimate to recover — the leak stays visible for debugging.
    const request = {
      model: "qwen/qwen3-coder",
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "x" }] }],
    };
    const client = new OpenAIClient({
      apiKey: "sk-test",
      extractToolCallsFromContent: true,
      fetch: async () => sseStream(LEAK_FRAMES),
    });
    const { finish } = await collect(client.stream(request, new AbortController().signal));
    expect(finish.toolCalls).toHaveLength(0);
    expect(finish.stopReason).toBe("end_turn");
    expect(finish.text).toContain("<function=");
  });

  it("test_flag_on_leaked_call_is_not_streamed_as_text (R7)", async () => {
    // R7: the leaked <function=…> dialect is HELD during streaming and never emitted as a text_delta;
    // finish() still recovers the call. shell_exec is declared in REQUEST.tools.
    const frames = [
      'data: {"choices":[{"index":0,"delta":{"content":"<function=shell_exec><parameter=command>echo hi"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"</parameter></function></tool_call>"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const client = new OpenAIClient({
      apiKey: "sk-test",
      extractToolCallsFromContent: true,
      fetch: async () => sseStream(frames),
    });
    const { events, finish } = await collect(client.stream(REQUEST, new AbortController().signal));
    const streamedText = events
      .filter((e) => e.type === "text_delta")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(streamedText).not.toContain("<function=");
    expect(finish.toolCalls).toHaveLength(1);
    expect(finish.toolCalls[0]?.name).toBe("shell_exec");
  });
});
