import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { Agent, StreamObjectError } from "../../../src/index.js";
import {
  blockStop,
  messageDelta,
  sseFrame,
  textBlockStart,
  textDelta,
} from "../../helpers/anthropic-sse.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

/**
 * Golden tests for `Agent.streamObject` — Phase 1 of v1.2 plan (ADR D39).
 * Covers: AsyncIterator contract, complete event, partial events monotonic,
 * disposal on success and on iter.return(), .refine() schema fallback,
 * parallel tool-use dedup (EC-6), compat with generateObject, and zod-missing
 * error.
 */

interface StubScript {
  iterations: Array<{
    toolName: string;
    rawInput: string;
    /**
     * Text chunks streamed BEFORE the tool call, in order.
     *
     * `streamObject` emits a `partial` when streamed TEXT best-effort-parses toward the schema
     * (stream-object.ts:163-173) — a tool call alone produces none. Without this the partials test
     * observed an empty array and its whole oracle sat inside a loop that never ran.
     */
    textChunks?: readonly string[];
  }>;
}

async function startStubAnthropic(script: StubScript): Promise<{ server: Server; url: string }> {
  let iter = 0;
  const server = createServer((req, res) => {
    if (req.url !== "/v1/messages") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const step = script.iterations[iter] ?? script.iterations[script.iterations.length - 1];
    if (step === undefined) {
      res.statusCode = 500;
      res.end();
      return;
    }
    iter += 1;
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    res.write(sseFrame("message_start", "{}"));
    for (const chunk of step.textChunks ?? []) {
      res.write(textBlockStart(0));
      res.write(textDelta(chunk, 0));
      res.write(blockStop(0));
    }
    res.write(
      sseFrame(
        "content_block_start",
        JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: `tu-${iter}`, name: step.toolName, input: {} },
        }),
      ),
    );
    res.write(
      sseFrame(
        "content_block_delta",
        JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: step.rawInput },
        }),
      ),
    );
    res.write(
      sseFrame("content_block_stop", JSON.stringify({ type: "content_block_stop", index: 0 })),
    );
    res.write(messageDelta("tool_use", { input_tokens: 11, output_tokens: 4 }));
    res.write(sseFrame("message_stop", "{}"));
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("server bind failed");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe("Agent.streamObject", () => {
  let cwd: string | undefined;
  let server: Server | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-streamobj-"));
    const __cwdCleanup1 = cwd;
    onTestFinished(async () => {
      await removeTempDirRobust(__cwdCleanup1);
    });
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

  it("emits at least one complete event", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      iterations: [{ toolName: "output", rawInput: JSON.stringify({ name: "alice", age: 30 }) }],
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const schema = z.object({ name: z.string(), age: z.number() });
    const events = [];
    for await (const evt of Agent.streamObject({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      schema,
      prompt: "Tell me about Alice",
      local: { cwd },
    })) {
      events.push(evt);
    }
    expect(events.filter((e) => e.type === "complete")).toHaveLength(1);
  });

  it("complete event carries fully Zod-parsed object", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      iterations: [{ toolName: "output", rawInput: JSON.stringify({ name: "bob", age: 22 }) }],
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const schema = z.object({ name: z.string(), age: z.number() });
    let completeEvt: { type: "complete"; object: { name: string; age: number } } | undefined;
    for await (const evt of Agent.streamObject({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      schema,
      prompt: "Tell me about Bob",
      local: { cwd },
    })) {
      if (evt.type === "complete") {
        completeEvt = evt as typeof completeEvt;
      }
    }
    expect(completeEvt).toBeDefined();
    expect(completeEvt?.object).toEqual({ name: "bob", age: 22 });
  });

  it("complete finish reason is tool_use", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      iterations: [{ toolName: "output", rawInput: JSON.stringify({ x: 1 }) }],
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    const schema = z.object({ x: z.number() });
    for await (const evt of Agent.streamObject({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      schema,
      prompt: "go",
      local: { cwd },
    })) {
      if (evt.type === "complete") {
        expect(evt.finishReason).toBe("tool_use");
      }
    }
  });

  it("complete.object matches what generateObject would return (compat)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      iterations: [
        { toolName: "output", rawInput: JSON.stringify({ a: 1, b: "hi" }) },
        { toolName: "output", rawInput: JSON.stringify({ a: 1, b: "hi" }) },
      ],
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const schema = z.object({ a: z.number(), b: z.string() });
    let streamComplete: { a: number; b: string } | undefined;
    for await (const evt of Agent.streamObject({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      schema,
      prompt: "x",
      local: { cwd },
    })) {
      if (evt.type === "complete") streamComplete = evt.object;
    }
    const gen = await Agent.generateObject({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      schema,
      prompt: "x",
      local: { cwd },
    });
    expect(streamComplete).toEqual(gen.object);
  });

  it("iter.return() mid-stream disposes transient agent (EC-4)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      iterations: [{ toolName: "output", rawInput: JSON.stringify({ x: 1 }) }],
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const schema = z.object({ x: z.number() });
    const iter = Agent.streamObject({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      schema,
      prompt: "go",
      local: { cwd },
    });
    // Pump iterator just enough to start, then return early.
    const before = await Agent.list();
    await iter.next();
    await iter.return();
    // After return(), generator's finally must have disposed the transient agent.
    const after = await Agent.list();
    // EXACTLY restored, not merely "no larger". `<=` also passes when the transient agent was never
    // created — which is the state a broken stream leaves behind, and the one this test is here to
    // tell apart from a clean disposal.
    expect(after.items.length).toBe(before.items.length);
  });

  it("ignores duplicate output tool calls (EC-6)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    // First iteration emits the canonical output; second has different input
    // but since first attempt already captured, we expect only the first to
    // be used (single-shot model).
    const stub = await startStubAnthropic({
      iterations: [{ toolName: "output", rawInput: JSON.stringify({ first: true }) }],
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const schema = z.object({ first: z.boolean() });
    let completed: { first: boolean } | undefined;
    for await (const evt of Agent.streamObject({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      schema,
      prompt: "x",
      local: { cwd },
    })) {
      if (evt.type === "complete") completed = evt.object;
    }
    expect(completed).toEqual({ first: true });
  });

  it("falls back to complete-only when schema has .refine()/.transform() (EC-5)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      iterations: [{ toolName: "output", rawInput: JSON.stringify({ count: 5 }) }],
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    const schema = z
      .object({ count: z.number() })
      .refine((d) => d.count > 0, "count must be positive");
    let completed: { count: number } | undefined;
    for await (const evt of Agent.streamObject({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      schema,
      prompt: "x",
      local: { cwd },
    })) {
      if (evt.type === "complete") completed = evt.object;
    }
    expect(completed).toEqual({ count: 5 });
  });

  it("throws StreamObjectError(no_tool_call) when LLM returns text only", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const noToolServer = createServer((req, res) => {
      if (req.url !== "/v1/messages") {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write(sseFrame("message_start", "{}"));
      res.write(
        sseFrame(
          "content_block_start",
          JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          }),
        ),
      );
      res.write(
        sseFrame(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "I refuse to call the tool." },
          }),
        ),
      );
      res.write(sseFrame("content_block_stop", "{}"));
      res.write(messageDelta("end_turn", { input_tokens: 5, output_tokens: 7 }));
      res.write(sseFrame("message_stop", "{}"));
      res.end();
    });
    await new Promise<void>((r) => noToolServer.listen(0, "127.0.0.1", () => r()));
    const address = noToolServer.address();
    if (typeof address !== "object" || address === null) throw new Error("bind failed");
    server = noToolServer;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = `http://127.0.0.1:${address.port}`;

    const schema = z.object({ x: z.number() });
    await expect(async () => {
      for await (const _ of Agent.streamObject({
        apiKey: "real-not-fixture",
        model: { id: "claude-sonnet-4-6" },
        schema,
        prompt: "x",
        local: { cwd },
        maxRetries: 0,
      })) {
        // drain
      }
    }).rejects.toBeInstanceOf(StreamObjectError);
  });

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test must inspect every partial sequentially to assert monotonic invariant; splitting harms test locality.
  it("attempt counter is monotonically increasing across partials", async () => {
    // This used to script a tool call and nothing else, and a tool call produces no `partial`.
    // MEASURED when the anchor below was added: `attempts.length` was 0, so the monotonic oracle sat
    // inside a loop that never ran and the test had never compared anything. Its comment said as
    // much — "we don't strictly require partials to be emitted ... we verify the type-level
    // invariant" — which is a description of asserting nothing.
    //
    // The stub now streams text that parses progressively toward the schema, which is what makes a
    // partial, so there is a real sequence to require monotonic.
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      iterations: [
        // Attempt 1 streams a parseable object and then calls the tool with a value the schema
        // REJECTS (`b` missing), which is what forces a second attempt. Attempt 2 succeeds.
        { toolName: "output", rawInput: JSON.stringify({ a: 1 }), textChunks: ['{"a": 1}'] },
        {
          toolName: "output",
          rawInput: JSON.stringify({ a: 1, b: 2 }),
          textChunks: ['{"a": 1, "b": 2}'],
        },
      ],
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    // The counter increments PER PARTIAL across the whole run, and `bestEffortPartialParse` requires
    // a BALANCED object — so a single streamed object yields exactly one partial no matter how it is
    // chunked, and the sequence this test is named for only exists across ATTEMPTS. The stub above
    // scripts two: the first tool call returns a value the schema rejects, forcing a retry.
    const schema = z.object({ a: z.number(), b: z.number() });
    const attempts: number[] = [];
    for await (const evt of Agent.streamObject({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      schema,
      prompt: "x",
      local: { cwd },
    })) {
      if (evt.type === "partial") attempts.push(evt.attempt);
    }
    // The anchor. Without it every assertion below sits inside a loop that does not run when the
    // stream produced no `partial` event, and the test reports a pass having compared nothing —
    // including in the case it exists to catch, where retries stopped being emitted at all.
    expect(
      attempts.length,
      "no partial events: there is no attempt sequence to check",
    ).toBeGreaterThan(1);

    // Strictly increasing (no duplicates, no regressions).
    for (let i = 1; i < attempts.length; i += 1) {
      const cur = attempts[i];
      const prev = attempts[i - 1];
      if (cur !== undefined && prev !== undefined) {
        expect(cur).toBeGreaterThan(prev);
      }
    }
  });

  it("registry leak == 0 after successful completion", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      iterations: [{ toolName: "output", rawInput: JSON.stringify({ x: 1 }) }],
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    const before = await Agent.list();
    const schema = z.object({ x: z.number() });
    for await (const _ of Agent.streamObject({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      schema,
      prompt: "x",
      local: { cwd },
    })) {
      // drain
    }
    const after = await Agent.list();
    // EXACTLY restored, not merely "no larger". `<=` also passes when the transient agent was never
    // created — which is the state a broken stream leaves behind, and the one this test is here to
    // tell apart from a clean disposal.
    expect(after.items.length).toBe(before.items.length);
  });
});
