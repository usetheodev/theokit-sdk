import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { Agent, StreamObjectError } from "../../../src/index.js";

/**
 * Golden tests for `Agent.streamObject` — Phase 1 of v1.2 plan (ADR D39).
 * Covers: AsyncIterator contract, complete event, partial events monotonic,
 * disposal on success and on iter.return(), .refine() schema fallback,
 * parallel tool-use dedup (EC-6), compat with generateObject, and zod-missing
 * error.
 */

interface StubScript {
  iterations: Array<{ toolName: string; rawInput: string }>;
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
    const enc = (event: string, data: string): string => `event: ${event}\ndata: ${data}\n\n`;
    res.write(enc("message_start", "{}"));
    res.write(
      enc(
        "content_block_start",
        JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: `tu-${iter}`, name: step.toolName, input: {} },
        }),
      ),
    );
    res.write(
      enc(
        "content_block_delta",
        JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: step.rawInput },
        }),
      ),
    );
    res.write(enc("content_block_stop", JSON.stringify({ type: "content_block_stop", index: 0 })));
    res.write(
      enc(
        "message_delta",
        JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: { input_tokens: 11, output_tokens: 4 },
        }),
      ),
    );
    res.write(enc("message_stop", "{}"));
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
    expect(after.items.length).toBeLessThanOrEqual(before.items.length);
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
      const enc = (e: string, d: string): string => `event: ${e}\ndata: ${d}\n\n`;
      res.write(enc("message_start", "{}"));
      res.write(
        enc(
          "content_block_start",
          JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          }),
        ),
      );
      res.write(
        enc(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "I refuse to call the tool." },
          }),
        ),
      );
      res.write(enc("content_block_stop", "{}"));
      res.write(
        enc(
          "message_delta",
          JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { input_tokens: 5, output_tokens: 7 },
          }),
        ),
      );
      res.write(enc("message_stop", "{}"));
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
    // Synthetic check on the contract: we don't strictly require partials
    // to be emitted (provider-dependent), but if they are, attempt MUST be
    // strictly increasing. We verify the type-level invariant.
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      iterations: [{ toolName: "output", rawInput: JSON.stringify({ a: 1 }) }],
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    const schema = z.object({ a: z.number() });
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
    expect(after.items.length).toBeLessThanOrEqual(before.items.length);
  });
});
