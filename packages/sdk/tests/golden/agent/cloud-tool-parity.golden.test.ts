import { describe, expect, it } from "vitest";

import { Agent, ConfigurationError } from "../../../src/index.js";

/**
 * ADR D15 + D16 + EC-3/EC-4/EC-5 — cloud tool parity validator rejects
 * inline configs that can't survive the trip to PaaS.
 *
 * Coverage of existing validations:
 *   - `programmatic_hooks_rejected` (universal — covers EC-4 hook closures)
 *   - `runtime_exclusive` (local + cloud both set; existing code)
 *   - `cloud_plugin_path_rejected`
 *   - `cloud_stdio_cwd_rejected`
 *
 * New codes added by `validateCloudToolParity`:
 *   - `cloud_incompatible_mcp_stdio_local` — stdio command on local FS path
 *   - `cloud_incompatible_function_resolver` — systemPrompt is a function
 */

const FIXTURE_KEY = "theo_test_cloud_tool_parity";
const MODEL = { id: "google/gemini-2.0-flash-exp:free" };
const REPOS = [{ url: "https://github.com/usetheo/example" }];

describe("validateCloudToolParity (ADR D15/D16)", () => {
  describe("rejections — function-based systemPrompt (cloud_incompatible_function_resolver)", () => {
    it("rejects systemPrompt declared as a function", async () => {
      const expectedCode = "cloud_incompatible_function_resolver";
      await expect(
        Agent.create({
          apiKey: FIXTURE_KEY,
          model: MODEL,
          cloud: { repos: REPOS },
          systemPrompt: async () => "dynamic",
        }),
      ).rejects.toBeInstanceOf(ConfigurationError);
      await expect(
        Agent.create({
          apiKey: FIXTURE_KEY,
          model: MODEL,
          cloud: { repos: REPOS },
          systemPrompt: async () => "dynamic",
        }),
      ).rejects.toMatchObject({ code: expectedCode });
    });

    it("accepts systemPrompt declared as a string", async () => {
      const agent = await Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS },
        systemPrompt: "You are a helpful assistant.",
      });
      expect(agent.agentId).toBeDefined();
      await agent.dispose();
    });

    it("accepts undefined systemPrompt", async () => {
      const agent = await Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS },
      });
      expect(agent.agentId).toBeDefined();
      await agent.dispose();
    });
  });

  describe("rejections — stdio MCP with local-FS path (cloud_incompatible_mcp_stdio_local, EC-3)", () => {
    it("rejects absolute path /usr/local/bin/x", async () => {
      await expect(
        Agent.create({
          apiKey: FIXTURE_KEY,
          model: MODEL,
          cloud: { repos: REPOS },
          mcpServers: { x: { type: "stdio", command: "/usr/local/bin/x" } },
        }),
      ).rejects.toMatchObject({ code: "cloud_incompatible_mcp_stdio_local" });
    });

    it("rejects home-relative path ~/bin/x", async () => {
      await expect(
        Agent.create({
          apiKey: FIXTURE_KEY,
          model: MODEL,
          cloud: { repos: REPOS },
          mcpServers: { x: { type: "stdio", command: "~/bin/x" } },
        }),
      ).rejects.toMatchObject({ code: "cloud_incompatible_mcp_stdio_local" });
    });

    it("rejects cwd-relative path ./bin/x", async () => {
      await expect(
        Agent.create({
          apiKey: FIXTURE_KEY,
          model: MODEL,
          cloud: { repos: REPOS },
          mcpServers: { x: { type: "stdio", command: "./bin/x" } },
        }),
      ).rejects.toMatchObject({ code: "cloud_incompatible_mcp_stdio_local" });
    });

    it("rejects parent-relative path ../bin/x", async () => {
      await expect(
        Agent.create({
          apiKey: FIXTURE_KEY,
          model: MODEL,
          cloud: { repos: REPOS },
          mcpServers: { x: { type: "stdio", command: "../bin/x" } },
        }),
      ).rejects.toMatchObject({ code: "cloud_incompatible_mcp_stdio_local" });
    });

    it("accepts bare command npx with args (EC-3: canonical MCP install pattern)", async () => {
      const agent = await Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS },
        mcpServers: {
          search: { type: "stdio", command: "npx", args: ["-y", "@some/mcp-server"] },
        },
      });
      expect(agent.agentId).toBeDefined();
      await agent.dispose();
    });

    it("accepts bare command uvx (Python ecosystem)", async () => {
      const agent = await Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS },
        mcpServers: { search: { type: "stdio", command: "uvx", args: ["mcp-server-x"] } },
      });
      expect(agent.agentId).toBeDefined();
      await agent.dispose();
    });

    it("accepts bare command node", async () => {
      const agent = await Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS },
        mcpServers: { search: { type: "stdio", command: "node", args: ["server.js"] } },
      });
      expect(agent.agentId).toBeDefined();
      await agent.dispose();
    });
  });

  describe("EC-4: hooks shape — programmatic hooks universally rejected", () => {
    it("rejects programmatic hooks field (existing universal `programmatic_hooks_rejected`)", async () => {
      // `hooks` is not on the public AgentOptions type — the validator
      // defensively rejects any caller who casts past TS to add it.
      const opts = {
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS },
        hooks: { preToolUse: async () => ({ allow: true }) },
      } as unknown as Parameters<typeof Agent.create>[0];
      await expect(Agent.create(opts)).rejects.toMatchObject({
        code: "programmatic_hooks_rejected",
      });
    });
  });

  describe("EC-5: local + cloud (existing `runtime_exclusive`)", () => {
    it("rejects local AND cloud both set", async () => {
      await expect(
        Agent.create({
          apiKey: FIXTURE_KEY,
          model: MODEL,
          local: { cwd: "/tmp/x" },
          cloud: { repos: REPOS },
        }),
      ).rejects.toMatchObject({ code: "runtime_exclusive" });
    });
  });

  describe("happy path — all rules satisfied", () => {
    it("accepts a fully compatible cloud agent config", async () => {
      const agent = await Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS, autoCreatePR: true },
        systemPrompt: "ship the change",
        mcpServers: {
          http: { type: "http", url: "https://mcp.example.com" },
          stdio: { type: "stdio", command: "npx", args: ["-y", "@x/mcp"] },
        },
      });
      expect(agent.agentId).toBeDefined();
      await agent.dispose();
    });
  });
});
