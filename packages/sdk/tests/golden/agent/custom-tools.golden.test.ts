import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent, ConfigurationError, type CustomTool } from "../../../src/index.js";

/**
 * Golden tests for the public `AgentOptions.tools` surface (inline custom
 * tools). Covers validation rules, end-to-end dispatch via a stub Anthropic
 * SSE server, and cloud rejection.
 */

interface ToolUseScript {
  toolName: string;
  toolInput: Record<string, unknown>;
  finalText: string;
}

async function startStubAnthropic(script: ToolUseScript): Promise<{ server: Server; url: string }> {
  let call = 0;
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
    call += 1;
    if (call === 1) {
      // First turn: emit a tool_use for the custom tool.
      res.write(
        encoder(
          "content_block_start",
          JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "tu-1",
              name: script.toolName,
              input: {},
            },
          }),
        ),
      );
      res.write(
        encoder(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: JSON.stringify(script.toolInput) },
          }),
        ),
      );
      res.write(
        encoder("content_block_stop", JSON.stringify({ type: "content_block_stop", index: 0 })),
      );
      res.write(
        encoder(
          "message_delta",
          JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      );
    } else {
      // Second turn: emit final text consuming the tool_result.
      res.write(
        encoder(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: script.finalText },
          }),
        ),
      );
      res.write(
        encoder(
          "message_delta",
          JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { input_tokens: 20, output_tokens: 5 },
          }),
        ),
      );
    }
    res.write(encoder("message_stop", "{}"));
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("server bind failed");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe("custom inline tools (AgentOptions.tools)", () => {
  let cwd: string | undefined;
  let server: Server | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-custom-tools-"));
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

  it("Agent.create accepts a tools array and dispatches the handler end-to-end", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      toolName: "current_time",
      toolInput: {},
      finalText: "It is now 2026-05-17T12:34:56Z.",
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    let invocations = 0;
    const currentTime: CustomTool = {
      name: "current_time",
      description: "Return the current UTC timestamp as ISO 8601.",
      inputSchema: { type: "object", properties: {} },
      handler: () => {
        invocations += 1;
        return "2026-05-17T12:34:56Z";
      },
    };
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
      tools: [currentTime],
    });
    const run = await agent.send("Que horas são?");
    const result = await run.wait();
    expect(result.status).toBe("finished");
    expect(invocations).toBe(1);
    expect(result.result).toContain("2026-05-17");
  });

  it("rejects reserved tool names (shell)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await expect(
      Agent.create({
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        tools: [
          {
            name: "shell",
            description: "shadow shell",
            inputSchema: { type: "object" },
            handler: () => "x",
          },
        ],
      }),
    ).rejects.toThrow(/reserved/);
  });

  it("rejects mcp_-prefixed tool names", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await expect(
      Agent.create({
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        tools: [
          {
            name: "mcp_filesystem_read",
            description: "shadow mcp",
            inputSchema: { type: "object" },
            handler: () => "x",
          },
        ],
      }),
    ).rejects.toThrow(/reserved/);
  });

  it("rejects duplicate tool names", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const tool: CustomTool = {
      name: "duped",
      description: "first",
      inputSchema: { type: "object" },
      handler: () => "a",
    };
    await expect(
      Agent.create({
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        tools: [tool, { ...tool, description: "second" }],
      }),
    ).rejects.toThrow(/Duplicate custom tool/);
  });

  it("rejects invalid tool names", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await expect(
      Agent.create({
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        tools: [
          {
            name: "1bad-start",
            description: "x",
            inputSchema: { type: "object" },
            handler: () => "x",
          },
        ],
      }),
    ).rejects.toThrow(/must match/);
  });

  it("rejects non-object input schemas", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await expect(
      Agent.create({
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        tools: [
          {
            name: "bad_schema",
            description: "x",
            inputSchema: { type: "string" } as Record<string, unknown>,
            handler: () => "x",
          },
        ],
      }),
    ).rejects.toThrow(/type: "object"/);
  });

  it("rejects cloud agents with non-empty tools", async () => {
    await expect(
      Agent.create({
        apiKey: "tk_cloud_key",
        model: { id: "claude-sonnet-4-6" },
        cloud: {},
        tools: [
          {
            name: "noop",
            description: "x",
            inputSchema: { type: "object" },
            handler: () => "x",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("per-call SendOptions.tools fully replaces AgentOptions.tools for this run", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      toolName: "per_call_tool",
      toolInput: {},
      finalText: "per-call done",
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    let agentInvocations = 0;
    let perCallInvocations = 0;
    const agentLevelTool: CustomTool = {
      name: "agent_level",
      description: "Agent-time tool that must NOT be visible on a send with a per-call override.",
      inputSchema: { type: "object", properties: {} },
      handler: () => {
        agentInvocations += 1;
        return "agent";
      },
    };
    const perCallTool: CustomTool = {
      name: "per_call_tool",
      description: "Per-call tool that overrides the agent-level catalog.",
      inputSchema: { type: "object", properties: {} },
      handler: () => {
        perCallInvocations += 1;
        return "per-call";
      },
    };
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
      tools: [agentLevelTool],
    });
    const run = await agent.send("invoke", { tools: [perCallTool] });
    const result = await run.wait();
    expect(result.status).toBe("finished");
    expect(perCallInvocations).toBe(1);
    expect(agentInvocations).toBe(0);
  });

  it("per-call empty array explicitly clears tools (model can only call shell)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      toolName: "agent_level",
      toolInput: {},
      finalText: "should not have called agent tool",
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    let invocations = 0;
    const agentLevelTool: CustomTool = {
      name: "agent_level",
      description: "Agent-time tool.",
      inputSchema: { type: "object", properties: {} },
      handler: () => {
        invocations += 1;
        return "agent";
      },
    };
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
      tools: [agentLevelTool],
    });
    // The stub still emits a tool_use for `agent_level`, but dispatch returns
    // `Unknown tool agent_level` (exit 127 → isError → loop short-circuits to
    // error). The agent-level tool was successfully suppressed.
    const run = await agent.send("invoke", { tools: [] });
    const result = await run.wait();
    expect(result.status).toBe("error");
    expect(invocations).toBe(0);
  });

  it("per-call undefined falls back to AgentOptions.tools", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      toolName: "fallback_tool",
      toolInput: {},
      finalText: "fallback done",
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    let invocations = 0;
    const fallbackTool: CustomTool = {
      name: "fallback_tool",
      description: "Agent-time tool that fires when SendOptions.tools is undefined.",
      inputSchema: { type: "object", properties: {} },
      handler: () => {
        invocations += 1;
        return "ok";
      },
    };
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
      tools: [fallbackTool],
    });
    // No `tools` in SendOptions → fall back to agent's tools.
    const run = await agent.send("invoke");
    const result = await run.wait();
    expect(result.status).toBe("finished");
    expect(invocations).toBe(1);
  });

  it("cloud agent rejects per-call tools at send time", async () => {
    const agent = await Agent.create({
      apiKey: "tk_cloud_send_tools",
      model: { id: "claude-sonnet-4-6" },
      cloud: {},
    });
    await expect(
      agent.send("invoke", {
        tools: [
          {
            name: "noop",
            description: "x",
            inputSchema: { type: "object" },
            handler: () => "x",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("per-call tools run the same validation rules as creation-time tools", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    process.env.ANTHROPIC_API_KEY = "sk-stub";

    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    await expect(
      agent.send("invoke", {
        tools: [
          {
            name: "shell",
            description: "shadow",
            inputSchema: { type: "object" },
            handler: () => "x",
          },
        ],
      }),
    ).rejects.toThrow(/reserved/);
    await expect(
      agent.send("invoke", {
        tools: [
          {
            name: "duped",
            description: "first",
            inputSchema: { type: "object" },
            handler: () => "a",
          },
          {
            name: "duped",
            description: "second",
            inputSchema: { type: "object" },
            handler: () => "b",
          },
        ],
      }),
    ).rejects.toThrow(/Duplicate/);
  });

  it("a thrown handler surfaces as a tool_result(isError) and ends the run with status error", async () => {
    // Matches the existing behaviour for shell/MCP/memory: non-zero exit
    // short-circuits the loop. Policy-hook denials are the only path that
    // intentionally suppresses `isError` so the model can retry (see
    // dispatchSingleCall in tool-dispatch.ts).
    if (cwd === undefined) throw new Error("missing workspace");
    const stub = await startStubAnthropic({
      toolName: "failer",
      toolInput: {},
      finalText: "unused — loop short-circuits before this turn fires",
    });
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;

    const failer: CustomTool = {
      name: "failer",
      description: "Always throws.",
      inputSchema: { type: "object", properties: {} },
      handler: () => {
        throw new Error("boom");
      },
    };
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
      tools: [failer],
    });
    const run = await agent.send("Run the failer.");
    const result = await run.wait();
    expect(result.status).toBe("error");
  });
});
