import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { Agent } from "../src/index.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the sessions landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * SE9 — integrated structured output via `agent.generate(input, { output })`: the user's tool loop runs
 * first, then the final answer is coerced into the Zod schema (reusing generateObject / ADR D33) and
 * returned as a validated, inferred-typed object. TDD RED-first.
 */

type Step = { kind: "tool"; name: string; input: unknown } | { kind: "text"; text: string };

function startStub(steps: Step[]): Promise<{ server: Server; url: string }> {
  let i = 0;
  const enc = (e: string, d: string) => `event: ${e}\ndata: ${d}\n\n`;
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
    res.write(enc("message_start", "{}"));
    if (step.kind === "tool") {
      res.write(
        enc(
          "content_block_start",
          JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: `tu-${i}`, name: step.name, input: {} },
          }),
        ),
      );
      res.write(
        enc(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(step.input) },
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
            delta: { type: "text_delta", text: step.text },
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

describe("agent.generate (SE9) — integrated structured output", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server !== undefined) await new Promise<void>((r) => server?.close(() => r()));
    server = undefined;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_BASE_URL;
  });

  it("runs the tool loop then returns a validated, typed object from the final answer", async () => {
    const stub = await startStub([
      { kind: "tool", name: "lookup", input: {} }, // phase 1: user tool runs
      { kind: "text", text: "Alice is 30 years old" }, // phase 1: final answer
      { kind: "tool", name: "output", input: { name: "alice", age: 30 } }, // phase 2: structuring
    ]);
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    let toolRan = false;
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      tools: [
        {
          name: "lookup",
          description: "Look someone up (SE9 test).",
          inputSchema: { type: "object", properties: {} },
          handler: () => {
            toolRan = true;
            return "Alice, age 30";
          },
        },
      ],
    });

    const schema = z.object({ name: z.string(), age: z.number() });
    const res = await agent.generate("Who is Alice?", { output: schema });

    expect(toolRan).toBe(true); // the user's tool ran first
    expect(res.object).toEqual({ name: "alice", age: 30 });
    // Compile-time inference: res.object is { name: string; age: number }
    const _typed: { name: string; age: number } = res.object;
    void _typed;
    expect(res.result.status).toBe("finished"); // the underlying loop run
    expect(res.result.result).toContain("Alice is 30");
    agent.dispose();
  });

  it("surfaces a typed error when the underlying run fails (no structuring over a failed run)", async () => {
    // A stub that 500s → the run errors before any answer.
    const bad = createServer((_req, res) => {
      res.statusCode = 500;
      res.end();
    });
    await new Promise<void>((r) => bad.listen(0, "127.0.0.1", () => r()));
    server = bad;
    const addr = bad.address();
    if (typeof addr !== "object" || addr === null) throw new Error("bind");
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = `http://127.0.0.1:${addr.port}`;

    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
    });
    await expect(
      agent.generate("x", { output: z.object({ a: z.string() }) }),
    ).rejects.toMatchObject({ name: "GenerateObjectError", code: "no_tool_call" });
    agent.dispose();
  });

  it("surfaces a typed error when the loop finishes with no text answer (tool-only)", async () => {
    // Phase-1 finishes but the last turn produced no text → nothing to structure.
    const stub = await startStub([{ kind: "text", text: "" }]);
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
    });
    await expect(
      agent.generate("x", { output: z.object({ a: z.string() }) }),
    ).rejects.toMatchObject({ name: "GenerateObjectError", code: "no_tool_call" });
    agent.dispose();
  });

  it("surfaces a typed error when the underlying run is cancelled (pre-aborted signal)", async () => {
    // A pre-aborted signal → no round starts → the phase-1 run resolves `cancelled`,
    // so there is nothing to structure. Deterministic (no network race): the signal
    // is already aborted before send, exercising the `cancelled` guard branch.
    const stub = await startStub([{ kind: "text", text: "unreached" }]);
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      agent.generate("x", { output: z.object({ a: z.string() }), signal: controller.signal }),
    ).rejects.toMatchObject({ name: "GenerateObjectError", code: "no_tool_call" });
    agent.dispose();
  });

  it("honors errorStrategy 'return-raw' when the structured output fails validation", async () => {
    const stub = await startStub([
      { kind: "text", text: "the answer" }, // phase 1: final answer
      { kind: "tool", name: "output", input: { a: 123 } }, // phase 2: schema-invalid (a must be string)
    ]);
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
    });
    // return-raw resolves with the raw unvalidated model input instead of throwing.
    const res = await agent.generate("x", {
      output: z.object({ a: z.string() }),
      errorStrategy: "return-raw",
    });
    expect(res.raw).toEqual({ a: 123 });
    agent.dispose();
  });
});
