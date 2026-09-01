/**
 * The agent handler, tested once.
 *
 * This replaces adapter-express.test.ts, adapter-fastify.test.ts and adapter-hono.test.ts. The three
 * files exercised three modules that were byte-identical below their docblocks, so they were three
 * copies of one fixture — and, as copies do, they had drifted apart: express and fastify differed
 * only in a `describe` string and one payload, while hono had four cases neither of them had
 * (streaming, 404, the error path, the onError callback). Express had one hono lacked (basePath).
 *
 * The cases below are the UNION, which is the point of consolidating rather than deleting two:
 * merging on the intersection would have silently dropped the coverage the divergence produced.
 */
import { describe, expect, it } from "vitest";

import { createAgentHandler } from "../../src/server/adapter/index.js";
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

describe("agent handler", () => {
  it("exports createAgentHandler function", () => {
    expect(typeof createAgentHandler).toEqual("function");
  });

  it("describes the routes it will answer, so a host can bind them without calling it", () => {
    // The contract is a DESCRIPTOR, not middleware — this is the half the deleted docblocks
    // misdescribed, and nothing asserted it.
    const handler = createAgentHandler(mockAgent);
    expect(handler.routes).toEqual([
      { method: "POST", path: "/agent/send" },
      { method: "GET", path: "/agent/stream" },
    ]);
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

  it("custom basePath works", async () => {
    const handler = createAgentHandler(mockAgent, { basePath: "/api/bot" });
    expect(handler.routes.map((r) => r.path)).toEqual(["/api/bot/send", "/api/bot/stream"]);
    const res = await handler.handleRequest({
      method: "POST",
      url: "http://localhost/api/bot/send",
      body: { input: "hello" },
    });
    expect(res.status).toEqual(200);
  });

  it("EC-8: error in send returns 500 and reaches onError", async () => {
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
