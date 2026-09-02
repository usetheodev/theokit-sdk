import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Agent } from "../src/index.js";
import { messageDelta, sseFrame } from "./helpers/anthropic-sse.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the sessions landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * SE18 — `SendOptions.activeTools` restricts, per send, which of the agent's
 * registered tools the model may actually call. A tool not in the list is vetoed
 * at dispatch (reusing the existing `withToolWhitelist` path that `Agent.fork`'s
 * `allowedTools` uses) — its handler never runs. Absent ⇒ the full toolset is
 * available. Mirrors a peer framework `activeTools` + the a peer framework.
 */
type Step = { kind: "tool"; name: string } | { kind: "text"; text: string };

function startStub(steps: Step[]): Promise<{ server: Server; url: string }> {
  let i = 0;
  const server = createServer((req, res) => {
    if (req.url !== "/v1/messages") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const step = steps[Math.min(i, steps.length - 1)]!;
    i += 1;
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    res.write(sseFrame("message_start", "{}"));
    if (step.kind === "tool") {
      res.write(
        sseFrame(
          "content_block_start",
          JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: `tu-${i}`, name: step.name, input: {} },
          }),
        ),
      );
      res.write(
        sseFrame(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: "{}" },
          }),
        ),
      );
      res.write(
        sseFrame("content_block_stop", JSON.stringify({ type: "content_block_stop", index: 0 })),
      );
      res.write(messageDelta("tool_use", { input_tokens: 10, output_tokens: 5 }));
    } else {
      res.write(
        sseFrame(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: step.text },
          }),
        ),
      );
      res.write(messageDelta("end_turn", { input_tokens: 20, output_tokens: 5 }));
    }
    res.write(sseFrame("message_stop", "{}"));
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      if (typeof a !== "object" || a === null) throw new Error("bind failed");
      resolve({ server, url: `http://127.0.0.1:${a.port}` });
    });
  });
}

describe("SendOptions.activeTools (SE18)", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server !== undefined) await new Promise<void>((r) => server?.close(() => r()));
    server = undefined;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_BASE_URL;
  });

  const makeAgent = async (blockedSpy: () => void, allowedSpy: () => void) =>
    Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      tools: [
        {
          name: "allowed",
          description: "Allowed tool",
          inputSchema: { type: "object", properties: {} },
          handler: () => {
            allowedSpy();
            return "allowed ran";
          },
        },
        {
          name: "blocked",
          description: "Blocked tool",
          inputSchema: { type: "object", properties: {} },
          handler: () => {
            blockedSpy();
            return "blocked ran";
          },
        },
      ],
    });

  it("vetoes a tool not in activeTools — its handler never runs", async () => {
    const stub = await startStub([
      { kind: "tool", name: "blocked" },
      { kind: "text", text: "done" },
    ]);
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const blockedSpy = vi.fn();
    const allowedSpy = vi.fn();
    const agent = await makeAgent(blockedSpy, allowedSpy);

    const run = await agent.send("do it", { activeTools: ["allowed"] });
    const result = await run.wait();

    expect(blockedSpy).not.toHaveBeenCalled(); // vetoed — never dispatched
    expect(result.status).toBe("finished"); // the loop continues past the veto to the text turn
    agent.dispose();
  });

  it("an empty activeTools list vetoes every tool (fail-closed)", async () => {
    const stub = await startStub([
      { kind: "tool", name: "allowed" },
      { kind: "text", text: "done" },
    ]);
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const blockedSpy = vi.fn();
    const allowedSpy = vi.fn();
    const agent = await makeAgent(blockedSpy, allowedSpy);

    const run = await agent.send("do it", { activeTools: [] }); // restrict to the empty set
    await run.wait();

    expect(allowedSpy).not.toHaveBeenCalled(); // even a normally-allowed tool is vetoed
    agent.dispose();
  });

  it("matching is exact against the registered name (a mixed-case tool needs its exact name)", async () => {
    const stub = await startStub([
      { kind: "tool", name: "MyTool" },
      { kind: "text", text: "done" },
    ]);
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const ran = vi.fn();
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      tools: [
        {
          name: "MyTool",
          description: "Mixed-case tool",
          inputSchema: { type: "object", properties: {} },
          handler: () => {
            ran();
            return "ok";
          },
        },
      ],
    });
    // A lowercase entry does NOT match the mixed-case registered name ⇒ vetoed.
    const run = await agent.send("do it", { activeTools: ["mytool"] });
    await run.wait();

    expect(ran).not.toHaveBeenCalled(); // exact-match contract, not lowercased for you
    agent.dispose();
  });

  it("without activeTools the full toolset is available — the tool runs", async () => {
    const stub = await startStub([
      { kind: "tool", name: "blocked" },
      { kind: "text", text: "done" },
    ]);
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const blockedSpy = vi.fn();
    const allowedSpy = vi.fn();
    const agent = await makeAgent(blockedSpy, allowedSpy);

    const run = await agent.send("do it"); // no activeTools
    await run.wait();

    expect(blockedSpy).toHaveBeenCalledOnce(); // full toolset — dispatched
    agent.dispose();
  });
});
