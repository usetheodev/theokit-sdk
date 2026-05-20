import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";
import { memoryDir } from "../../../src/internal/memory/markdown-store.js";

/**
 * Increment A — memory_search + memory_get tools must show up in the real
 * LLM's tool catalog when `memory.enabled === true` and `memory.index.tools`
 * is not disabled.
 */

interface Captured {
  body: Record<string, unknown> | undefined;
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
    const sse = (event: string, data: string): void => {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("bind failed");
  return { server, url: `http://127.0.0.1:${addr.port}`, captured };
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

describe("memory tools wiring through Agent.create/send", () => {
  let cwd: string;
  let server: Server | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-memtoolswire-"));
    await mkdir(memoryDir(cwd), { recursive: true });
  });

  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((r) => server?.close(() => r()));
      server = undefined;
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_BASE_URL;
  });

  it("registers memory_search + memory_get with the LLM when memory.enabled", async () => {
    const stub = await startStubAnthropic();
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    await writeFile(
      join(memoryDir(cwd), "MEMORY.md"),
      "# Memory\n\n## Facts\n\n- some fact.\n",
      "utf8",
    );
    const agent = await Agent.create({
      apiKey: "user-real-memtools",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      memory: { enabled: true },
    });
    await (await agent.send("anything")).wait();
    const tools = (stub.captured.body?.tools ?? []) as Array<{ name: string }>;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("memory_search");
    expect(toolNames).toContain("memory_get");
  });

  it("omits memory tools when memory.enabled is false", async () => {
    const stub = await startStubAnthropic();
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    const agent = await Agent.create({
      apiKey: "user-real-memtools-off",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
    });
    await (await agent.send("anything")).wait();
    const tools = (stub.captured.body?.tools ?? []) as Array<{ name: string }>;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).not.toContain("memory_search");
    expect(toolNames).not.toContain("memory_get");
  });

  it("omits memory tools when memory.index.tools is explicitly false", async () => {
    const stub = await startStubAnthropic();
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    const agent = await Agent.create({
      apiKey: "user-real-memtools-optout",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      memory: { enabled: true, index: { tools: false } },
    });
    await (await agent.send("anything")).wait();
    const tools = (stub.captured.body?.tools ?? []) as Array<{ name: string }>;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).not.toContain("memory_search");
  });
});
