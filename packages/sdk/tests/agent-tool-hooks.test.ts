/**
 * Tool lifecycle hooks (Production-Readiness #4, ADRs D315–D317).
 *
 * WHAT THIS FILE USED TO BE. Three tests, none of which observed a hook firing. The first passed the
 * three callbacks to `Agent.create` and asserted `expect(agent).toBeDefined()` — construction, and
 * its own comment said so. The second asserted all three were NOT called. The third, titled "listener
 * errors are swallowed (do not crash agent loop)", registered a throwing `onToolStart` and then ran
 * in fixture mode with no tools, so the throwing listener was never invoked: it proved that
 * `agent.send("hi")` resolves, which the test above it already proved with a non-throwing listener.
 * The docblock deferred the real semantics to "golden tests + Phase 7 dogfood".
 *
 * The surface-acceptance and not-invoked cases are kept — they are true and cheap — and three cases
 * are added that drive a real tool through dispatch over an Anthropic wire stub, which is the harness
 * `define-tool-to-model-output-split.test.ts` already uses for exactly this.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { z } from "zod";
import { Agent } from "../src/agent.js";
import { Tool } from "../src/define-tool.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../src/internal/runtime/registry/agent-registry.js";
import { clearAllSessions } from "../src/internal/session/agent-session.js";
import { messageDelta, sseFrame } from "./helpers/anthropic-sse.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

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

const FIXTURE_KEY = "theo_test_tool_hooks";
const MODEL = { id: "openai/gpt-4o-mini" };

describe("AgentOptions tool lifecycle hooks — surface (T5.1)", () => {
  let root: string;

  beforeEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    root = await mkdtemp(join(tmpdir(), "theokit-tool-hooks-"));
  });

  afterEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    await rm(root, { recursive: true, force: true });
  });

  it("accepts onToolStart / onToolEnd / onToolError callbacks", async () => {
    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();
    const onToolError = vi.fn();
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      onToolStart,
      onToolEnd,
      onToolError,
    });
    // Surface present in type system + runtime accepts construction.
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  it("hooks not invoked when no tools fire (fixture mode default)", async () => {
    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();
    const onToolError = vi.fn();
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      onToolStart,
      onToolEnd,
      onToolError,
    });
    await agent.send("hi");
    await agent.dispose();
    expect(onToolStart).not.toHaveBeenCalled();
    expect(onToolEnd).not.toHaveBeenCalled();
    expect(onToolError).not.toHaveBeenCalled();
  });
});

describe("tool lifecycle hooks fire through a real dispatch (D315–D317)", () => {
  // `Agent.create` without `local.cwd` defaults to process.cwd(), which during a test run is
  // packages/sdk — so a run persists real session state into the package tree. Measured: the three
  // cases below left three .theokit/memory/sessions/run-*.md behind before this line existed, and
  // the suite's own pollution gate is what caught it.
  useTempCwd();

  let stub: StubResult | undefined;
  let prevKey: string | undefined;
  let prevUrl: string | undefined;

  beforeEach(() => {
    prevKey = process.env.ANTHROPIC_API_KEY;
    prevUrl = process.env.ANTHROPIC_API_BASE_URL;
  });

  afterEach(async () => {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = prevUrl;
    if (stub !== undefined) {
      await new Promise<void>((resolve) => stub?.server.close(() => resolve()));
      stub = undefined;
    }
  });

  async function runWithTool(
    handler: () => string,
    hooks: {
      onToolStart?: (e: unknown) => void;
      onToolEnd?: (e: unknown) => void;
      onToolError?: (e: unknown) => void;
    },
  ): Promise<void> {
    stub = await startStub("probe");
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      ...hooks,
      tools: [
        Tool.create({
          name: "probe",
          description: "a tool that actually runs",
          inputSchema: z.object({}),
          handler,
        }),
      ],
    });
    const run = await agent.send("go");
    for await (const _ of run.stream()) {
      // drain
    }
    await agent.dispose();
  }

  it("a succeeding tool fires onToolStart then onToolEnd, and never onToolError", async () => {
    const order: string[] = [];
    await runWithTool(() => "ok", {
      onToolStart: () => order.push("start"),
      onToolEnd: () => order.push("end"),
      onToolError: () => order.push("error"),
    });
    expect(order).toEqual(["start", "end"]);
  });

  it("a throwing tool fires onToolError, and the run still finishes", async () => {
    const order: string[] = [];
    let seen: unknown;
    await runWithTool(
      () => {
        throw new Error("tool blew up");
      },
      {
        onToolStart: () => order.push("start"),
        onToolEnd: () => order.push("end"),
        onToolError: (e) => {
          order.push("error");
          seen = e;
        },
      },
    );
    expect(order[0]).toBe("start");
    expect(order, "the failure must reach onToolError").toContain("error");
    expect(seen, "and it must carry something about the failure").toBeDefined();
  });

  it("a THROWING listener does not break the run — with the tool actually dispatched", async () => {
    // D317's real claim. The version this replaces registered a throwing onToolStart and then ran in
    // fixture mode with NO TOOLS, so the listener was never called: it asserted that send() resolves,
    // which the neighbouring test already showed with a listener that does not throw.
    const ended: string[] = [];
    await expect(
      runWithTool(() => "ok", {
        onToolStart: () => {
          throw new Error("listener crashed");
        },
        onToolEnd: () => ended.push("end"),
      }),
    ).resolves.toBeUndefined();

    expect(
      ended,
      "a crashing onToolStart must not stop the dispatch — onToolEnd still fires",
    ).toEqual(["end"]);
  });
});
