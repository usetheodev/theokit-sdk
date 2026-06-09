import { describe, expect, it } from "vitest";
import { createAgentHandler } from "../../src/server/adapter/express.js";

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

describe("express adapter", () => {
  it("exports createAgentHandler", () => {
    expect(typeof createAgentHandler).toEqual("function");
  });

  it("handles POST /agent/send", async () => {
    const handler = createAgentHandler(mockAgent);
    const res = await handler.handleRequest({
      method: "POST",
      url: "http://localhost/agent/send",
      body: { input: "test" },
    });
    expect(res.status).toEqual(200);
  });

  it("custom basePath works", async () => {
    const handler = createAgentHandler(mockAgent, { basePath: "/api/v1" });
    const res = await handler.handleRequest({
      method: "POST",
      url: "http://localhost/api/v1/send",
      body: { input: "custom" },
    });
    expect(res.status).toEqual(200);
  });
});
