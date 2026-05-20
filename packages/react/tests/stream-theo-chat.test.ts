import { AuthenticationError, ConfigurationError, type SDKAgent } from "@usetheo/sdk";
import { describe, expect, it } from "vitest";
import { streamTheoChat } from "../src/stream-theo-chat.js";

// Tests stand up a duck-typed agent (just `send`); cast through unknown so we
// don't have to mock the entire SDKAgent surface.
const asAgent = (a: { send: (msg: string) => Promise<unknown> }): SDKAgent =>
  a as unknown as SDKAgent;

/**
 * Tests for `streamTheoChat` SSE server handler — Vercel AI Data Stream v1.
 * Covers the wire format, plus EC-2: pre-stream errors return typed HTTP
 * status codes instead of silent 500s.
 */

interface MockAgentScript {
  /** Throw a typed error before the stream starts. */
  preStreamThrow?: Error;
  /** Emit assistant text + tool calls during the stream. */
  events?: Array<
    | { type: "assistant"; text: string }
    | { type: "tool_call"; status: "running"; name: string; callId: string }
    | { type: "tool_call"; status: "completed"; name: string; callId: string; stdout: string }
  >;
  /** Final wait() status. */
  finishStatus?: "finished" | "error" | "cancelled";
  /** Throw mid-stream. */
  midStreamThrow?: Error;
}

function makeMockAgent(script: MockAgentScript): { send: (msg: string) => Promise<unknown> } {
  return {
    send: async (_msg: string) => {
      if (script.preStreamThrow !== undefined) throw script.preStreamThrow;
      const events = script.events ?? [];
      return {
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test fixture must script every wire-format branch (assistant / tool_call running / tool_call completed / midStreamThrow); refactoring would obscure the per-script linear narrative.
        stream: async function* () {
          for (const evt of events) {
            if (evt.type === "assistant") {
              yield {
                type: "assistant",
                message: { content: [{ type: "text", text: evt.text }] },
              };
            } else if (evt.type === "tool_call") {
              if (evt.status === "running") {
                yield {
                  type: "tool_call",
                  call_id: evt.callId,
                  name: evt.name,
                  status: "running",
                };
              } else {
                yield {
                  type: "tool_call",
                  call_id: evt.callId,
                  name: evt.name,
                  status: "completed",
                  result: { stdout: evt.stdout },
                };
              }
            }
          }
          if (script.midStreamThrow !== undefined) throw script.midStreamThrow;
        },
        wait: async () => ({ status: script.finishStatus ?? "finished" }),
      };
    },
  };
}

async function readBody(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("streamTheoChat", () => {
  it("emits text deltas in Data Stream v1 format", async () => {
    const agent = makeMockAgent({
      events: [
        { type: "assistant", text: "first" },
        { type: "assistant", text: "second" },
      ],
    });

    const response = await streamTheoChat({
      agent: asAgent(agent),
      body: { agentId: "a", messages: [{ role: "user", content: "hi" }] },
    });
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await readBody(response);
    expect(body).toContain('0:"first"');
    expect(body).toContain('0:"second"');
  });

  it("emits tool_call events with codes 9 and a", async () => {
    const agent = makeMockAgent({
      events: [
        { type: "tool_call", status: "running", name: "echo", callId: "tu-1" },
        { type: "tool_call", status: "completed", name: "echo", callId: "tu-1", stdout: "hi" },
      ],
    });

    const response = await streamTheoChat({
      agent: asAgent(agent),
      body: { agentId: "a", messages: [{ role: "user", content: "go" }] },
    });
    const body = await readBody(response);
    expect(body).toContain('9:{"toolCallId":"tu-1","toolName":"echo"}');
    expect(body).toContain('a:{"toolCallId":"tu-1","result":"hi"}');
  });

  it("emits finish event d: at end of stream", async () => {
    const agent = makeMockAgent({ events: [{ type: "assistant", text: "ok" }] });

    const response = await streamTheoChat({
      agent: asAgent(agent),
      body: { agentId: "a", messages: [{ role: "user", content: "x" }] },
    });
    const body = await readBody(response);
    expect(body).toMatch(/d:\{"finishReason"/);
  });

  it("emits error code 3 when stream throws mid-flight", async () => {
    const agent = makeMockAgent({
      events: [{ type: "assistant", text: "starting" }],
      midStreamThrow: new Error("rate_limit"),
    });

    const response = await streamTheoChat({
      agent: asAgent(agent),
      body: { agentId: "a", messages: [{ role: "user", content: "x" }] },
    });
    expect(response.status).toBe(200); // stream-level error, not HTTP
    const body = await readBody(response);
    expect(body).toContain('3:"rate_limit"');
  });

  it("EC-2: returns HTTP 400 with JSON body on pre-stream ConfigurationError", async () => {
    const agent = makeMockAgent({
      preStreamThrow: new ConfigurationError("Local agents require a model selection", {
        code: "missing_model",
      }),
    });

    const response = await streamTheoChat({
      agent: asAgent(agent),
      body: { agentId: "a", messages: [{ role: "user", content: "hi" }] },
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("missing_model");
  });

  it("EC-2: returns HTTP 401 with JSON body on pre-stream AuthenticationError", async () => {
    const agent = makeMockAgent({
      preStreamThrow: new AuthenticationError("Missing API key", { code: "missing_api_key" }),
    });

    const response = await streamTheoChat({
      agent: asAgent(agent),
      body: { agentId: "a", messages: [{ role: "user", content: "hi" }] },
    });
    expect(response.status).toBe(401);
  });
});
