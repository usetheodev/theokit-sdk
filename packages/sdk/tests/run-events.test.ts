import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { PermissionEngine, PermissionPlugin } from "../src/index.js";
import { emitRunEvent, type RunEvent } from "../src/types/run-events.js";

/**
 * SE2 — typed runtime event stream. The pure `emitRunEvent` is fail-safe; the
 * end-to-end wiring emits `permission_denied` when a permission plugin blocks a
 * tool and `tool_progress` when a tool dispatches, delivered opt-in via
 * `SendOptions.onRunEvent` — ADDITIVE to the `SDKMessage` content stream.
 *
 * TDD RED-first.
 */

describe("emitRunEvent (SE2) — fail-safe emitter", () => {
  it("no-ops when the sink is absent", () => {
    expect(() =>
      emitRunEvent(undefined, { type: "tool_progress", toolName: "x", toolCallId: "1" }),
    ).not.toThrow();
  });

  it("delivers the event to the sink", () => {
    const seen: RunEvent[] = [];
    emitRunEvent((e) => seen.push(e), { type: "rate_limit", attempt: 1, retryAfterMs: 500 });
    expect(seen).toEqual([{ type: "rate_limit", attempt: 1, retryAfterMs: 500 }]);
  });

  it("swallows a throwing sink (observability never breaks the run)", () => {
    expect(() =>
      emitRunEvent(
        () => {
          throw new Error("boom");
        },
        { type: "compact_boundary", trigger: "auto" },
      ),
    ).not.toThrow();
  });
});

// ── Integration: drive a real run against a stub Anthropic ────────────────────

interface Script {
  toolName: string;
}

function startStub(script: Script): Promise<{ server: Server; url: string }> {
  let call = 0;
  const enc = (event: string, data: string) => `event: ${event}\ndata: ${data}\n\n`;
  const server = createServer((req, res) => {
    if (req.url !== "/v1/messages") {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    res.write(enc("message_start", "{}"));
    call += 1;
    if (call === 1) {
      res.write(
        enc(
          "content_block_start",
          JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "tu-1", name: script.toolName, input: {} },
          }),
        ),
      );
      res.write(
        enc(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: "{}" },
          }),
        ),
      );
      res.write(
        enc("content_block_stop", JSON.stringify({ type: "content_block_stop", index: 0 })),
      );
      res.write(
        enc(
          "message_delta",
          JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      );
    } else {
      res.write(
        enc(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "done" },
          }),
        ),
      );
      res.write(
        enc(
          "message_delta",
          JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { input_tokens: 20, output_tokens: 5 },
          }),
        ),
      );
    }
    res.write(enc("message_stop", "{}"));
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

async function drainWithEvents(opts: { toolAction: "deny" | "allow" }): Promise<RunEvent[]> {
  const { Agent } = await import("../src/index.js");
  const stub = await startStub({ toolName: "risky" });
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevUrl = process.env.ANTHROPIC_API_BASE_URL;
  process.env.ANTHROPIC_API_KEY = "sk-stub";
  process.env.ANTHROPIC_API_BASE_URL = stub.url;
  const events: RunEvent[] = [];
  try {
    const engine = new PermissionEngine([{ tool: "risky", action: opts.toolAction }]);
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      tools: [
        {
          name: "risky",
          description: "A tool gated by the permission plugin (SE2 test).",
          inputSchema: { type: "object", properties: {} },
          handler: () => "ok",
        },
      ],
      // The engine's rule decides deny/allow directly for "risky"; no ask branch,
      // so no canUseTool is needed for this test (a "deny" rule short-circuits).
      plugins: [PermissionPlugin.create(engine)],
    });
    const run = await agent.send("do it", { onRunEvent: (e) => events.push(e) });
    for await (const _ of run.stream()) {
      // drain
    }
  } finally {
    // Restore env WITHOUT coercing `undefined` to the string "undefined".
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = prevUrl;
    stub.server.close();
  }
  return events;
}

describe("RunEvent wiring (SE2) — end-to-end via onRunEvent", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("emits permission_denied when a permission plugin blocks a tool", async () => {
    const events = await drainWithEvents({ toolAction: "deny" });
    const denied = events.find((e) => e.type === "permission_denied");
    expect(denied).toBeDefined();
    expect(denied).toMatchObject({
      type: "permission_denied",
      toolName: "risky",
      source: "plugin",
    });
  });

  it("emits tool_progress when a tool dispatches (allowed)", async () => {
    const events = await drainWithEvents({ toolAction: "allow" });
    const progress = events.find((e) => e.type === "tool_progress");
    expect(progress).toBeDefined();
    expect(progress).toMatchObject({ type: "tool_progress", toolName: "risky" });
  });
});
