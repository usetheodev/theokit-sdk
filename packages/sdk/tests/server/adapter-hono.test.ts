import { describe, expect, it } from "vitest";
import { createAgentHandler } from "../../src/server/adapter/hono.js";
import type { AgentLike } from "../../src/server/adapter/types.js";

const mockAgent: AgentLike = {
  send(input: string) {
    return {
      async *stream() {
        yield { type: "text", text: `echo: ${input}` };
      },
      async wait() {
        return { status: "finished", output: `echo: ${input}` };
      },
    };
  },
  dispose() {},
};

describe("hono adapter", () => {
  it("exports createAgentHandler function", () => {
    expect(typeof createAgentHandler).toEqual("function");
  });

  it("handles POST /agent/send", async () => {
    const handler = createAgentHandler(mockAgent);
    const res = await handler.handleRequest({
      method: "POST",
      url: "http://localhost/agent/send",
      body: { input: "hello" },
    });
    expect(res.status).toEqual(200);
    expect(res.body).toEqual({ status: "finished", output: "echo: hello" });
  });

  it("handles GET /agent/stream", async () => {
    const handler = createAgentHandler(mockAgent);
    const res = await handler.handleRequest({
      method: "GET",
      url: "http://localhost/agent/stream?input=hi",
    });
    expect(res.status).toEqual(200);
    expect(res.stream).toBeDefined();
  });

  it("returns 404 for unknown routes", async () => {
    const handler = createAgentHandler(mockAgent);
    const res = await handler.handleRequest({
      method: "GET",
      url: "http://localhost/unknown",
    });
    expect(res.status).toEqual(404);
  });

  it("EC-8: error in send returns 500", async () => {
    const errorAgent: AgentLike = {
      send() {
        return {
          async *stream() {},
          async wait() {
            throw new Error("boom");
          },
        };
      },
      dispose() {},
    };
    const errors: Error[] = [];
    const handler = createAgentHandler(errorAgent, { onError: (e) => errors.push(e) });
    const res = await handler.handleRequest({
      method: "POST",
      url: "http://localhost/agent/send",
      body: { input: "fail" },
    });
    expect(res.status).toEqual(500);
    expect(errors.length).toEqual(1);
  });
});
