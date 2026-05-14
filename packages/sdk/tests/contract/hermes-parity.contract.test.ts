import { afterEach, describe, expect, it } from "vitest";

import { Agent, type SDKToolUseMessage } from "../../src/index.js";
import { collectStream } from "../helpers/collect-stream.js";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("Hermes reference parity contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("pairs duplicate same-name tool_call lifecycle events by unique call_id", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Run two shell commands: pwd and ls src.");

    const events = await collectStream(run);
    const toolCalls = events.filter(isShellToolCall);
    const running = toolCalls.filter((event) => event.status === "running");
    const completed = toolCalls.filter((event) => event.status === "completed");

    expect(running).toHaveLength(2);
    expect(completed).toHaveLength(2);
    expect(new Set(running.map((event) => event.call_id)).size).toBe(2);
    expect(completed.map((event) => event.call_id).sort()).toEqual(
      running.map((event) => event.call_id).sort(),
    );
    expect(normalizeForGolden(toolCalls)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call",
          name: "shell",
          call_id: "call-<id>",
          args: "<unknown>",
          result: "<unknown>",
        }),
      ]),
    );
  });

  it("sanitizes MCP server names with punctuation into stable public tool names", async () => {
    workspace = await createTempWorkspace("project-with-theokit-mcp");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
      mcpServers: {
        "github/tools.v1": {
          type: "stdio",
          command: "node",
          args: ["./mcp-server.js"],
          cwd: workspace.cwd,
        },
      },
    });
    const run = await agent.send("List MCP tools.");

    const events = await collectStream(run);
    const system = events.find((event) => event.type === "system");

    expect(system).toMatchObject({
      tools: expect.arrayContaining([expect.stringMatching(/^mcp_github_tools_v1_/)]),
    });
    expect(JSON.stringify(system)).not.toContain("github/tools.v1");
  });

  it("redacts common provider tokens from stream, errors, artifacts, and conversation", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const secrets = {
      OPENAI_API_KEY: "sk-proj-abc123def456ghi789jkl012",
      GITHUB_TOKEN: "ghp_abc123def456ghi789jkl",
      AUTH_HEADER: "Bearer mytoken123456789012345678",
    };
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
      mcpServers: {
        secretServer: {
          type: "stdio",
          command: "node",
          args: ["./mcp-server.js"],
          env: secrets,
        },
      },
    });
    const run = await agent.send("Print env and then summarize without exposing secrets.");

    const events = await collectStream(run);
    const result = await run.wait();
    const conversation = await run.conversation();
    const artifacts = await agent.listArtifacts();
    const publicOutput = JSON.stringify({ events, result, conversation, artifacts });

    expect(publicOutput).not.toContain(secrets.OPENAI_API_KEY);
    expect(publicOutput).not.toContain("abc123def456");
    expect(publicOutput).not.toContain(secrets.AUTH_HEADER);
    expect(publicOutput).toContain("***");
  });

  it("resume preserves conversation history but not inline secrets or mutable arrays", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
      mcpServers: {
        ephemeral: {
          type: "http",
          url: "https://mcp.example.test",
          headers: { Authorization: "Bearer resume-secret-token" },
        },
      },
    });
    const firstRun = await agent.send("Remember: the fixture answer is 42.");
    await firstRun.wait();

    const resumed = await Agent.resume(agent.agentId, {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const followup = await resumed.send("What answer did I ask you to remember?");
    const followupResult = await followup.wait();
    const conversation = await followup.conversation();

    expect(followupResult).toMatchObject({
      status: "finished",
      result: expect.stringMatching(/42/),
    });
    expect(JSON.stringify(conversation)).toContain("42");
    expect(JSON.stringify({ followupResult, conversation })).not.toContain("resume-secret-token");
    expect(JSON.stringify({ followupResult, conversation })).not.toContain("ephemeral");
  });
});

function isShellToolCall(event: unknown): event is SDKToolUseMessage {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { type?: unknown }).type === "tool_call" &&
    (event as { name?: unknown }).name === "shell"
  );
}
