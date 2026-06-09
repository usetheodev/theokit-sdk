import { describe, expect, it } from "vitest";
import { createAgentHandler } from "../../src/server/adapter/fastify.js";

const mockAgent = {
  send(input: string) {
    return {
      async *stream() {
        yield { text: input };
      },
      async wait() {
        return { status: "finished", output: input };
      },
    };
  },
  dispose() {},
};

describe("fastify adapter", () => {
  it("exports createAgentHandler", () => {
    expect(typeof createAgentHandler).toEqual("function");
  });

  it("handles POST /agent/send", async () => {
    const handler = createAgentHandler(mockAgent);
    const res = await handler.handleRequest({
      method: "POST",
      url: "http://localhost/agent/send",
      body: { input: "fast" },
    });
    expect(res.status).toEqual(200);
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
});
