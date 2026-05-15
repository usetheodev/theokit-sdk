import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";

/**
 * Behaviour gate for `AgentOptions.systemPrompt` and
 * `SendOptions.systemPrompt`. Stub provider endpoints capture the request
 * body so each priority path (agent string, agent resolver, send override,
 * undefined) can be asserted against the actual wire shape.
 */

interface CapturedRequest {
  body: Record<string, unknown> | undefined;
}

async function startStubAnthropic(): Promise<{
  server: Server;
  url: string;
  captured: CapturedRequest;
}> {
  const captured: CapturedRequest = { body: undefined };
  const server = createServer((req, res) => {
    if (req.url !== "/v1/messages") {
      res.statusCode = 404;
      res.end();
      return;
    }
    let buffered = "";
    req.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
    });
    req.on("end", () => {
      captured.body = JSON.parse(buffered) as Record<string, unknown>;
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      const encoder = (event: string, data: string): string => `event: ${event}\ndata: ${data}\n\n`;
      res.write(encoder("message_start", "{}"));
      res.write(
        encoder(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "ok" },
          }),
        ),
      );
      res.write(
        encoder(
          "message_delta",
          JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        ),
      );
      res.write(encoder("message_stop", "{}"));
      res.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("server bind failed");
  return { server, url: `http://127.0.0.1:${address.port}`, captured };
}

async function startStubPaaS(): Promise<{
  server: Server;
  url: string;
  captured: CapturedRequest;
}> {
  const captured: CapturedRequest = { body: undefined };
  const server = createServer((req, res) => {
    if (req.url === "/v1/agents" && req.method === "POST") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ agentId: "bc-stub-systemprompt", model: { id: "composer-2" } }));
      return;
    }
    if (!req.url?.startsWith("/v1/agents/")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    let buffered = "";
    req.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
    });
    req.on("end", () => {
      captured.body = JSON.parse(buffered) as Record<string, unknown>;
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      const send = (event: string, data: Record<string, unknown>): void => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      send("status", { status: "CREATING" });
      send("assistant", { text: "ok" });
      send("result", { status: "finished", result: "ok" });
      res.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("server bind failed");
  return { server, url: `http://127.0.0.1:${address.port}`, captured };
}

describe("systemPrompt routing", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_BASE_URL;
    delete process.env.THEOKIT_API_BASE_URL;
  });

  it("threads AgentOptions.systemPrompt (string) into the Anthropic request body", async () => {
    const stub = await startStubAnthropic();
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const agent = await Agent.create({
      apiKey: "user-real-systemprompt",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd: process.cwd() },
      systemPrompt: "Be terse.",
    });
    const run = await agent.send("hi");
    await run.wait();

    expect(stub.captured.body?.system).toBe("Be terse.");
  });

  it("threads AgentOptions.systemPrompt (resolver) into the Anthropic request body", async () => {
    const stub = await startStubAnthropic();
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const agent = await Agent.create({
      apiKey: "user-real-systemprompt",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd: process.cwd() },
      systemPrompt: async (ctx) => `Agent ${ctx.agentId}`,
    });
    const run = await agent.send("hi");
    await run.wait();

    expect(typeof stub.captured.body?.system).toBe("string");
    expect(stub.captured.body?.system).toMatch(/^Agent agent-/);
  });

  it("SendOptions.systemPrompt overrides AgentOptions.systemPrompt", async () => {
    const stub = await startStubAnthropic();
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const agent = await Agent.create({
      apiKey: "user-real-systemprompt",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd: process.cwd() },
      systemPrompt: "A",
    });
    const run = await agent.send("hi", { systemPrompt: "B" });
    await run.wait();

    expect(stub.captured.body?.system).toBe("B");
  });

  it("omits `system` from the request body when neither is set", async () => {
    const stub = await startStubAnthropic();
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const agent = await Agent.create({
      apiKey: "user-real-systemprompt",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd: process.cwd() },
    });
    const run = await agent.send("hi");
    await run.wait();

    expect(stub.captured.body).toBeDefined();
    expect("system" in (stub.captured.body ?? {})).toBe(false);
  });

  it("includes systemPrompt in the cloud Run POST body (EC-1 / ADR D7)", async () => {
    const stub = await startStubPaaS();
    server = stub.server;
    process.env.THEOKIT_API_BASE_URL = stub.url;

    const agent = await Agent.create({
      apiKey: "user-real-cloud-systemprompt",
      model: { id: "composer-2" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
      systemPrompt: "Cloud agent persona.",
    });
    const run = await agent.send("hello cloud");
    await run.wait();

    expect(stub.captured.body?.systemPrompt).toBe("Cloud agent persona.");
  });
});
