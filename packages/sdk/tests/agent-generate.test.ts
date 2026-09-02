import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { _structurableAnswerOrThrowForTests } from "../src/agent-generate.js";
import { Agent } from "../src/index.js";
import { messageDelta, sseFrame } from "./helpers/anthropic-sse.js";
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
            delta: { type: "input_json_delta", partial_json: JSON.stringify(step.input) },
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
    ).rejects.toMatchObject({ name: "GenerateObjectError", code: "upstream_run_failed" });
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
    ).rejects.toMatchObject({ name: "GenerateObjectError", code: "no_text_answer" });
    agent.dispose();
  });

  it("surfaces a typed error when a pre-aborted signal stops the run before an answer", async () => {
    // MEASURED, and it is not what this test used to claim. Its comment said "the phase-1 run
    // resolves `cancelled` ... exercising the `cancelled` guard branch"; the run actually resolves
    // `error`, so the guard reached is the upstream-failure one. Nothing could tell while all three
    // guards threw the same `no_tool_call` code — which is the finding this fix comes from, showing
    // up in the opposite direction. The `cancelled` branch is covered directly below instead.
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
    ).rejects.toMatchObject({ name: "GenerateObjectError", code: "upstream_run_failed" });
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

describe("structurableAnswerOrThrow — one code per cause", () => {
  /**
   * Three genuinely different upstream conditions used to throw the byte-identical oracle
   * `{ name: "GenerateObjectError", code: "no_tool_call" }`, so swapping any two setups left all
   * three tests green. Only the free-text message differed, and `docs/error-codes.md` states this
   * SDK's codes are contract without qualification.
   *
   * Driven directly because one of the three is unreachable from an integration test: a pre-aborted
   * signal produces `status: "error"`, not `"cancelled"` — measured, after the codes were split. The
   * integration test above asserts what that path really does; this covers the branch it does not
   * reach.
   */
  class Ctor extends Error {
    constructor(
      readonly code: string,
      message: string,
      override readonly cause?: unknown,
    ) {
      super(message);
    }
  }

  it("an errored run is upstream_run_failed, naming the underlying error", () => {
    expect(() =>
      _structurableAnswerOrThrowForTests(
        { status: "error", error: { message: "boom", code: "provider_down" } } as never,
        Ctor as never,
      ),
    ).toThrow(/boom.*provider_down/);
    try {
      _structurableAnswerOrThrowForTests({ status: "error" } as never, Ctor as never);
    } catch (err) {
      expect((err as Ctor).code).toBe("upstream_run_failed");
    }
  });

  it("a cancelled run is run_cancelled", () => {
    try {
      _structurableAnswerOrThrowForTests({ status: "cancelled" } as never, Ctor as never);
      expect.unreachable("the cancelled guard did not fire");
    } catch (err) {
      expect((err as Ctor).code).toBe("run_cancelled");
    }
  });

  it("a tool-only completion is no_text_answer", () => {
    for (const result of [{ status: "finished" }, { status: "finished", result: "" }]) {
      try {
        _structurableAnswerOrThrowForTests(result as never, Ctor as never);
        expect.unreachable("the empty-answer guard did not fire");
      } catch (err) {
        expect((err as Ctor).code).toBe("no_text_answer");
      }
    }
  });

  it("returns the answer when there is one", () => {
    expect(
      _structurableAnswerOrThrowForTests(
        { status: "finished", result: "hello" } as never,
        Ctor as never,
      ),
    ).toBe("hello");
  });
});
