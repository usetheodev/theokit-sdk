import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { Agent } from "../src/agent.js";
import { Tool } from "../src/define-tool.js";
import { messageDelta, sseFrame } from "./helpers/anthropic-sse.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the sessions landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * SE17 (gap closure) — the model-facing vs app-facing tool-output SPLIT must be
 * REAL end-to-end, not a lossy overwrite. DoD 2 + DoD 5: with `toModelOutput`
 * set, the MODEL sees the compact representation in the outbound `tool_result`,
 * WHILE the FULL raw handler output reaches the observability surface
 * (`onToolEnd`). Adversarial review found the transform was applied inside the
 * handler, so `onToolEnd` only ever saw the compact value — the app lost the
 * full result. This drives a real run over an Anthropic wire stub and asserts
 * BOTH channels independently.
 */

interface StubResult {
  server: Server;
  url: string;
  bodies: unknown[];
}

/** A minimal Anthropic SSE stub: round 1 emits a tool_use for `toolName`, round 2 ends. */
function startStub(toolName: string): Promise<StubResult> {
  const bodies: unknown[] = [];
  let call = 0;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      if (req.url !== "/v1/messages") {
        res.statusCode = 404;
        res.end();
        return;
      }
      bodies.push(JSON.parse(raw));
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(sseFrame("message_start", "{}"));
      call += 1;
      if (call === 1) {
        res.write(
          sseFrame(
            "content_block_start",
            JSON.stringify({
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tu-1", name: toolName, input: {} },
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
              delta: { type: "text_delta", text: "done" },
            }),
          ),
        );
        res.write(messageDelta("end_turn", { input_tokens: 20, output_tokens: 5 }));
      }
      res.write(sseFrame("message_stop", "{}"));
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      if (typeof a !== "object" || a === null) throw new Error("bind failed");
      resolve({ server, url: `http://127.0.0.1:${a.port}`, bodies });
    });
  });
}

/** The tool_result content block sent back to the provider on the 2nd request. */
function toolResultContentFrom(bodies: unknown[]): unknown {
  const second = bodies[1] as { messages?: Array<{ content?: unknown }> } | undefined;
  for (const m of second?.messages ?? []) {
    const parts = Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [];
    const tr = parts.find((p) => p.type === "tool_result");
    if (tr !== undefined) return tr.content;
  }
  return undefined;
}

describe("Tool toModelOutput (SE17) — real model/app split end-to-end", () => {
  let stub: StubResult | undefined;
  let prevKey: string | undefined;
  let prevUrl: string | undefined;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = prevUrl;
    stub?.server.close();
    stub = undefined;
  });

  it("sends the COMPACT value to the model while onToolEnd receives the FULL raw output", async () => {
    stub = await startStub("weather");
    prevKey = process.env.ANTHROPIC_API_KEY;
    prevUrl = process.env.ANTHROPIC_API_BASE_URL;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const observed: unknown[] = [];
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      onToolEnd: (e) => {
        observed.push(e.result);
      },
      tools: [
        Tool.create({
          name: "weather",
          description: "Get weather",
          inputSchema: z.object({}),
          outputSchema: z.object({ location: z.string(), temp: z.number(), icon: z.string() }),
          handler: () => ({ location: "SF", temp: 68, icon: "http://icon.png" }),
          // The model sees ONLY the compact string — never the icon URL.
          toModelOutput: (o) => `${o.location}: ${o.temp}F`,
        }),
      ],
    });
    const run = await agent.send("go");
    for await (const _ of run.stream()) {
      // drain
    }
    agent.dispose();

    // MODEL-facing: the outbound tool_result is the compact string, NO `icon`.
    const modelFacing = toolResultContentFrom(stub.bodies);
    expect(modelFacing).toBe("SF: 68F");
    expect(JSON.stringify(modelFacing)).not.toContain("icon");

    // APP-facing: onToolEnd received the FULL raw output (the icon URL is present).
    expect(observed).toHaveLength(1);
    const full = observed[0];
    expect(typeof full).toBe("string");
    expect(JSON.parse(full as string)).toEqual({
      location: "SF",
      temp: 68,
      icon: "http://icon.png",
    });
  });

  it("without toModelOutput, onToolEnd and the model see the SAME serialized output (back-compat)", async () => {
    stub = await startStub("weather");
    prevKey = process.env.ANTHROPIC_API_KEY;
    prevUrl = process.env.ANTHROPIC_API_BASE_URL;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const observed: unknown[] = [];
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      onToolEnd: (e) => {
        observed.push(e.result);
      },
      tools: [
        Tool.create({
          name: "weather",
          description: "Get weather",
          inputSchema: z.object({}),
          outputSchema: z.object({ temp: z.number() }),
          handler: () => ({ temp: 20 }),
        }),
      ],
    });
    const run = await agent.send("go");
    for await (const _ of run.stream()) {
      // drain
    }
    agent.dispose();

    const modelFacing = toolResultContentFrom(stub.bodies);
    expect(JSON.parse(modelFacing as string)).toEqual({ temp: 20 });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(modelFacing);
  });
});
