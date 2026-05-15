import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";

/**
 * Behaviour gate for the real cloud Run. Stub PaaS HTTP server emits the
 * three-event SSE shape (`status`, `assistant`, `result`); the SDK is
 * expected to translate them into our `SDKMessage` stream.
 */

async function startPaaSStub(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url === "/v1/agents" && req.method === "POST") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ agentId: "bc-stub-123", model: { id: "composer-2" } }));
      return;
    }
    if (!req.url?.startsWith("/v1/agents/")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    const send = (event: string, data: Record<string, unknown>): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send("status", { status: "CREATING" });
    send("status", { status: "RUNNING" });
    send("assistant", { text: "Cloud says hi" });
    send("status", { status: "FINISHED" });
    send("result", { status: "finished", result: "Cloud says hi" });
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("server bind failed");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe("real cloud runtime", () => {
  let server: Server | undefined;
  beforeEach(async () => {
    const stub = await startPaaSStub();
    server = stub.server;
    process.env.THEOKIT_API_BASE_URL = stub.url;
  });
  afterEach(async () => {
    delete process.env.THEOKIT_API_BASE_URL;
    if (server !== undefined) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  it("streams a real cloud Run through the SSE protocol", async () => {
    const agent = await Agent.create({
      apiKey: "user-real-cloud-key",
      model: { id: "composer-2" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });
    const run = await agent.send("Run in the cloud");
    const events: string[] = [];
    for await (const event of run.stream()) {
      if (event.type === "status") events.push(`status:${event.status}`);
      if (event.type === "assistant") {
        const text = event.message.content.find((part) => part.type === "text")?.text ?? "";
        events.push(`assistant:${text}`);
      }
    }
    const result = await run.wait();
    expect(events).toContain("status:CREATING");
    expect(events).toContain("status:RUNNING");
    expect(events).toContain("status:FINISHED");
    expect(events).toContain("assistant:Cloud says hi");
    expect(result.status).toBe("finished");
    expect(result.result).toBe("Cloud says hi");
  });
});
