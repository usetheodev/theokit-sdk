import type { IncomingMessage } from "node:http";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";

/**
 * Behaviour gate for `AgentOptions.systemPrompt` and
 * `SendOptions.systemPrompt`. Stub provider endpoints capture the request
 * body so each priority path is asserted against the actual wire shape.
 */

interface Captured {
  body: Record<string, unknown> | undefined;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
    });
    req.on("end", () => resolve(buf));
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("bind failed");
  return `http://127.0.0.1:${addr.port}`;
}

async function startStubAnthropic(): Promise<{ server: Server; url: string; captured: Captured }> {
  const captured: Captured = { body: undefined };
  const server = createServer(async (req, res) => {
    if (req.url !== "/v1/messages") {
      res.statusCode = 404;
      res.end();
      return;
    }
    captured.body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    const sse = (e: string, d: string): void => {
      res.write(`event: ${e}\ndata: ${d}\n\n`);
    };
    sse("message_start", "{}");
    sse(
      "content_block_delta",
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "ok" },
      }),
    );
    sse(
      "message_delta",
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    sse("message_stop", "{}");
    res.end();
  });
  return { server, url: await listen(server), captured };
}

async function startStubPaaS(): Promise<{ server: Server; url: string; captured: Captured }> {
  const captured: Captured = { body: undefined };
  const server = createServer(async (req, res) => {
    if (req.url === "/v1/agents" && req.method === "POST") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ agentId: "bc-stub-sp", model: { id: "composer-2" } }));
      return;
    }
    if (!req.url?.startsWith("/v1/agents/")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    captured.body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    const send = (e: string, d: Record<string, unknown>): void => {
      res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
    };
    send("status", { status: "CREATING" });
    send("assistant", { text: "ok" });
    send("result", { status: "finished", result: "ok" });
    res.end();
  });
  return { server, url: await listen(server), captured };
}

const localBase = {
  apiKey: "user-real-systemprompt",
  model: { id: "claude-sonnet-4-6" },
  local: { cwd: process.cwd() },
} as const;

describe("systemPrompt routing", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((r) => server?.close(() => r()));
      server = undefined;
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_BASE_URL;
    delete process.env.THEOKIT_API_BASE_URL;
  });

  async function withAnthropic(): Promise<Captured> {
    const stub = await startStubAnthropic();
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    return stub.captured;
  }

  it("threads AgentOptions.systemPrompt (string) into the Anthropic body", async () => {
    const captured = await withAnthropic();
    const agent = await Agent.create({ ...localBase, systemPrompt: "Be terse." });
    await (await agent.send("hi")).wait();
    expect(captured.body?.system).toBe("Be terse.");
  });

  it("threads AgentOptions.systemPrompt (resolver) into the Anthropic body", async () => {
    const captured = await withAnthropic();
    const agent = await Agent.create({
      ...localBase,
      systemPrompt: async (ctx) => `Agent ${ctx.agentId}`,
    });
    await (await agent.send("hi")).wait();
    expect(captured.body?.system).toMatch(/^Agent agent-/);
  });

  it("SendOptions.systemPrompt overrides AgentOptions.systemPrompt", async () => {
    const captured = await withAnthropic();
    const agent = await Agent.create({ ...localBase, systemPrompt: "A" });
    await (await agent.send("hi", { systemPrompt: "B" })).wait();
    expect(captured.body?.system).toBe("B");
  });

  it("omits `system` from the body when neither is set", async () => {
    const captured = await withAnthropic();
    const agent = await Agent.create({ ...localBase });
    await (await agent.send("hi")).wait();
    expect("system" in (captured.body ?? {})).toBe(false);
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
    await (await agent.send("hello cloud")).wait();
    expect(stub.captured.body?.systemPrompt).toBe("Cloud agent persona.");
  });
});
