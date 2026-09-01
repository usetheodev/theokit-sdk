import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Agent } from "../../../src/index.js";
import type { ConversationStep } from "../../../src/types/conversation.js";
import type { InteractionUpdate } from "../../../src/types/updates.js";
import { sseFrame } from "../../helpers/anthropic-sse.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

/**
 * Behaviour gate proving `SendOptions.onStep` / `onDelta` fire in the real
 * LLM agent loop. Uses an in-process stub Anthropic SSE server so the assertions
 * are deterministic + free.
 */

interface StubOptions {
  textFrames?: string[];
  toolCall?: { name: string; input: Record<string, unknown> };
  /** When true, the second request (after tool_result) returns plain end_turn. */
  twoTurn?: boolean;
}

type SseWriter = (event: string, data: string) => void;

function writeTextDeltas(sse: SseWriter, frames: string[]): void {
  for (const text of frames) {
    sse(
      "content_block_delta",
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      }),
    );
  }
}

function writeToolUse(
  sse: SseWriter,
  call: { name: string; input: Record<string, unknown> },
): void {
  sse(
    "content_block_start",
    JSON.stringify({
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_1", name: call.name, input: call.input },
    }),
  );
  sse(
    "message_delta",
    JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
}

function writeEndTurn(sse: SseWriter): void {
  sse(
    "message_delta",
    JSON.stringify({
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
}

async function startStubAnthropic(initial: StubOptions): Promise<{ server: Server; url: string }> {
  let turn = 0;
  const server = createServer((req, res) => {
    if (req.url !== "/v1/messages") {
      res.statusCode = 404;
      res.end();
      return;
    }
    turn += 1;
    const isFirstTurn = turn === 1;
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    const sse: SseWriter = (event, data) => {
      res.write(sseFrame(event, data));
    };
    sse("message_start", "{}");
    writeTextDeltas(sse, isFirstTurn ? (initial.textFrames ?? []) : ["all done"]);
    if (isFirstTurn && initial.toolCall !== undefined) {
      writeToolUse(sse, initial.toolCall);
    } else {
      writeEndTurn(sse);
    }
    sse("message_stop", "{}");
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("bind failed");
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

describe("real-runtime callbacks (SendOptions.onStep / onDelta)", () => {
  let cwd: string | undefined;
  let server: Server | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-callbacks-"));
    const __cwdCleanup1 = cwd;
    onTestFinished(async () => {
      await removeTempDirRobust(__cwdCleanup1);
    });
  });

  afterEach(async () => {
    cwd = undefined;
    if (server !== undefined) {
      await new Promise<void>((r) => server?.close(() => r()));
      server = undefined;
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_BASE_URL;
  });

  async function mountStub(opts: StubOptions): Promise<void> {
    const stub = await startStubAnthropic(opts);
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
  }

  it("fires onDelta once per streamed text token", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await mountStub({ textFrames: ["Hello ", "from ", "Anthropic"] });
    const deltas: InteractionUpdate[] = [];
    const agent = await Agent.create({
      apiKey: "user-real-callbacks",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    const run = await agent.send("hi", {
      onDelta: ({ update }) => {
        deltas.push(update);
      },
    });
    const result = await run.wait();
    expect(result.status).toBe("finished");
    const textDeltas = deltas.filter((u) => u.type === "text-delta");
    expect(textDeltas).toHaveLength(3);
    expect(textDeltas.map((u) => (u.type === "text-delta" ? u.text : ""))).toEqual([
      "Hello ",
      "from ",
      "Anthropic",
    ]);
  });

  it("fires onDelta tool-call-started + tool-call-completed LIVE, before the final answer text (#47-followup order)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    // Round 1 = tool-only (no text, like gpt-5.4's content:null + tool_calls); round 2 = "all done".
    await mountStub({ toolCall: { name: "shell", input: { command: "echo ok" } } });
    const deltas: InteractionUpdate[] = [];
    const agent = await Agent.create({
      apiKey: "user-real-callbacks-lifecycle",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    const run = await agent.send("run it", {
      onDelta: ({ update }) => {
        deltas.push(update);
      },
    });
    await run.wait();
    const started = deltas.findIndex((u) => u.type === "tool-call-started");
    const completed = deltas.findIndex((u) => u.type === "tool-call-completed");
    const firstText = deltas.findIndex((u) => u.type === "text-delta");
    // The tool lifecycle surfaces LIVE via onDelta (the change that lets the bridge drop its answer-hold).
    expect(started).toBeGreaterThanOrEqual(0);
    expect(completed).toBeGreaterThan(started);
    // ...and BEFORE the post-tool answer text — the order the merge bridge now relies on instead of holding text.
    expect(firstText).toBeGreaterThan(completed);
    const s = deltas[started];
    const c = deltas[completed];
    expect(
      s?.type === "tool-call-started" && c?.type === "tool-call-completed" && s.callId === c.callId,
    ).toBe(true);
  });

  it("fires onStep exactly once for a single-turn assistant message", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await mountStub({ textFrames: ["the answer is 42"] });
    const steps: ConversationStep[] = [];
    const agent = await Agent.create({
      apiKey: "user-real-callbacks",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    const run = await agent.send("question", {
      onStep: ({ step }) => {
        steps.push(step);
      },
    });
    const result = await run.wait();
    expect(result.status).toBe("finished");
    expect(steps).toHaveLength(1);
    expect(steps[0]?.type).toBe("assistantMessage");
    if (steps[0]?.type === "assistantMessage") {
      expect(steps[0].message.text).toBe("the answer is 42");
    }
  });

  it("fires onStep for tool calls AND the final assistant text turn", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await mountStub({
      toolCall: { name: "shell", input: { command: "echo ok" } },
      twoTurn: true,
    });
    const steps: ConversationStep[] = [];
    const agent = await Agent.create({
      apiKey: "user-real-callbacks-tool",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    const run = await agent.send("run a command", {
      onStep: ({ step }) => {
        steps.push(step);
      },
    });
    await run.wait();
    const types = steps.map((s) => s.type);
    expect(types).toContain("toolCall");
    // SE39 — onStep now emits the paired toolResult too (was toolCall-only). A live-stream
    // consumer (e.g. the Claude Code transcript writer) needs the result, not just the call.
    expect(types).toContain("toolResult");
    expect(types).toContain("assistantMessage");
    // the toolResult carries the same callId as its toolCall — paired in BOTH directions
    // (zero dangling toolCall AND zero orphan toolResult downstream).
    const callIds = steps.filter((s) => s.type === "toolCall").map((s) => s.message.callId);
    const resultIds = steps.filter((s) => s.type === "toolResult").map((s) => s.message.callId);
    for (const id of callIds) expect(resultIds).toContain(id);
    for (const id of resultIds) expect(callIds).toContain(id);
  });

  it("does not crash the run when onDelta throws", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await mountStub({ textFrames: ["safe", " path"] });
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const agent = await Agent.create({
      apiKey: "user-real-callbacks-throw",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    const run = await agent.send("hi", {
      onDelta: () => {
        throw new Error("callback boom");
      },
    });
    const result = await run.wait();
    expect(result.status).toBe("finished");
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });

  it("completes the run when no callbacks are passed at all", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await mountStub({ textFrames: ["ok"] });
    const agent = await Agent.create({
      apiKey: "user-real-callbacks-none",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    const run = await agent.send("hi");
    const result = await run.wait();
    expect(result.status).toBe("finished");
  });
});
