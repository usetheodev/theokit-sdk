import { AuthenticationError, ConfigurationError, type SDKAgent } from "@usetheo/sdk";
import { describe, expect, it } from "vitest";

import { streamCompletion } from "../src/stream-completion.js";

/**
 * Tests for `streamCompletion` — single-shot text generation server handler.
 * Vercel AI Data Stream v1 wire format, EC-2 pre-stream typed errors.
 */

const asAgent = (a: { send: (msg: string) => Promise<unknown> }): SDKAgent =>
  a as unknown as SDKAgent;

interface MockScript {
  preStreamThrow?: Error;
  texts?: string[];
  finishStatus?: "finished" | "error" | "cancelled";
}

function makeMockAgent(script: MockScript): { send: (msg: string) => Promise<unknown> } {
  return {
    send: async (_msg: string) => {
      if (script.preStreamThrow !== undefined) throw script.preStreamThrow;
      return {
        stream: async function* () {
          for (const t of script.texts ?? []) {
            yield {
              type: "assistant",
              message: { content: [{ type: "text", text: t }] },
            };
          }
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

describe("streamCompletion", () => {
  it("returns 400 when prompt is missing", async () => {
    const agent = makeMockAgent({});
    const response = await streamCompletion({ agent: asAgent(agent), body: { prompt: "" } });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("missing_prompt");
  });

  it("emits text deltas in Data Stream v1 format", async () => {
    const agent = makeMockAgent({ texts: ["hello", " world"] });
    const response = await streamCompletion({
      agent: asAgent(agent),
      body: { prompt: "hi" },
    });
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await readBody(response);
    expect(body).toContain('0:"hello"');
    expect(body).toContain('0:" world"');
  });

  it("emits d: finish event at end of stream", async () => {
    const agent = makeMockAgent({ texts: ["ok"] });
    const response = await streamCompletion({
      agent: asAgent(agent),
      body: { prompt: "x" },
    });
    const body = await readBody(response);
    expect(body).toMatch(/d:\{"finishReason"/);
  });

  it("EC-2: returns HTTP 400 with JSON body on pre-stream ConfigurationError", async () => {
    const agent = makeMockAgent({
      preStreamThrow: new ConfigurationError("missing model", { code: "missing_model" }),
    });
    const response = await streamCompletion({
      agent: asAgent(agent),
      body: { prompt: "hi" },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("missing_model");
  });

  it("EC-2: returns HTTP 401 with JSON body on pre-stream AuthenticationError", async () => {
    const agent = makeMockAgent({
      preStreamThrow: new AuthenticationError("missing key", { code: "missing_api_key" }),
    });
    const response = await streamCompletion({
      agent: asAgent(agent),
      body: { prompt: "hi" },
    });
    expect(response.status).toBe(401);
  });
});
