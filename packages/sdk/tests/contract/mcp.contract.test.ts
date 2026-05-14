import { afterEach, describe, expect, it } from "vitest";

import { Agent, type AgentOptions } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("MCP server contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("loads only inline MCP servers by default and keeps secrets out of stream events", async () => {
    workspace = await createTempWorkspace("project-with-theokit-mcp");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
      mcpServers: {
        inlineHttp: {
          type: "http",
          url: "https://mcp.example.test",
          headers: { Authorization: "Bearer top-secret" },
        },
      },
    });

    const run = await agent.send("List available MCP tools.");
    const events = [];
    for await (const event of run.stream()) events.push(event);

    expect(JSON.stringify(events)).not.toContain("top-secret");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "system",
          tools: expect.arrayContaining([expect.stringMatching(/inlineHttp/)]),
        }),
      ]),
    );
  });

  it("settingSources controls project MCP and send-time mcpServers replace create-time servers", async () => {
    workspace = await createTempWorkspace("project-with-theokit-mcp");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd, settingSources: ["project"] },
      mcpServers: {
        createOnly: {
          type: "stdio",
          command: "node",
          args: ["./mcp-server.js"],
          cwd: workspace.cwd,
        },
      },
    });

    const run = await agent.send("Which MCP servers are active?", {
      mcpServers: {
        sendOnly: { type: "stdio", command: "node", args: ["./mcp-server.js"], cwd: workspace.cwd },
      },
    });
    const events = [];
    for await (const event of run.stream()) events.push(event);

    const systemEvent = events.find((event) => event.type === "system");
    expect(systemEvent).toMatchObject({
      tools: expect.arrayContaining([
        expect.stringMatching(/sendOnly/),
        expect.stringMatching(/fixture-shell/),
      ]),
    });
    expect(JSON.stringify(systemEvent)).not.toContain("createOnly");
  });

  it("does not persist inline MCP servers after Agent.resume", async () => {
    workspace = await createTempWorkspace("project-with-theokit-mcp");
    const created = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
      mcpServers: { ephemeral: { type: "stdio", command: "node", args: ["./mcp-server.js"] } },
    });

    const resumed = await Agent.resume(created.agentId, {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await resumed.send("List MCP tools after resume.");
    const events = [];
    for await (const event of run.stream()) events.push(event);

    expect(JSON.stringify(events)).not.toContain("ephemeral");
  });

  it("rejects stdio cwd for cloud MCP servers", async () => {
    const options: AgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
      mcpServers: {
        badCloudStdio: { type: "stdio", command: "node", cwd: "/tmp" },
      },
    };

    await expect(Agent.create(options)).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/cwd|cloud|stdio/i),
    });
  });
});
