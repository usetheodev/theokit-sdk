import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/index.js";

/**
 * Behaviour gate proving the real local runtime activates when a non-fixture
 * API key is paired with a provider env credential. Uses an in-process
 * stub HTTP server to simulate Anthropic SSE streaming.
 */

import { createServer, type Server } from "node:http";

async function startStubAnthropic(textFrames: string[]): Promise<{
  server: Server;
  url: string;
}> {
  const server = createServer((req, res) => {
    if (req.url !== "/v1/messages") {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    const encoder = (event: string, data: string): string => `event: ${event}\ndata: ${data}\n\n`;
    res.write(encoder("message_start", "{}"));
    for (const text of textFrames) {
      res.write(
        encoder(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text },
          }),
        ),
      );
    }
    res.write(
      encoder(
        "message_delta",
        JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      ),
    );
    res.write(encoder("message_stop", "{}"));
    res.end();
    req.on("close", () => undefined);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("server bind failed");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe("real local runtime", () => {
  let cwd: string | undefined;
  let server: Server | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-real-local-"));
    await writeFile(join(cwd, "data.txt"), "answer-is-42\n");
  });
  afterEach(async () => {
    cwd = undefined;
    if (server !== undefined) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_BASE_URL;
  });

  it("routes a non-fixture key through the real LLM loop", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic(["Hello from", " real Anthropic"]);
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub-anthropic";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const agent = await Agent.create({
      apiKey: "user-real-key-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    const run = await agent.send("Say hi");
    const result = await run.wait();
    expect(result.status).toBe("finished");
    expect(result.result).toContain("Hello from real Anthropic");
  });
});
