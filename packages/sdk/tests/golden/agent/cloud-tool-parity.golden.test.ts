import { describe, expect, it } from "vitest";

import { Agent, ConfigurationError } from "../../../src/index.js";
import type { CloudAgent } from "../../../src/internal/cloud-agent/cloud-agent.js";

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
const MODEL = { id: "google/gemini-2.0-flash-001" };
const REPOS = [{ url: "https://github.com/usetheo/example" }];

/**
 * B-072. Every accept-path test below used to assert only `expect(agent.agentId).toBeDefined()`.
 * An id exists for any agent the validator lets through, so the oracle was "did not throw" — which
 * cannot see the failure mode this validator actually has: accepting a field and then silently
 * DROPPING it on the way to PaaS. The accepted value has to be observed where it matters, and the
 * place it matters is `cloudPayload` — the canonical JSON contract (ADR D15) that PaaS receives,
 * documented on `CloudAgent` as public precisely so contract tests can inspect what would be sent.
 *
 * Same cast the existing cloud-agent-payload-wiring golden uses: `Agent.create` is typed to the
 * public `SDKAgent`, and `cloudPayload` is a CloudAgent field.
 *
 * The `expect(agent.agentId).toBeDefined()` line is gone from all seven rather than kept beside
 * the new assertion: it is the "did not throw" oracle this item exists to remove, and reading the
 * payload already fails if creation did not produce an agent. Keeping it would leave the smell in
 * the file next to its own fix.
 */
function payloadOf(agent: unknown): CloudAgent["cloudPayload"] {
  return (agent as CloudAgent).cloudPayload;
}

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

      expect(
        payloadOf(agent).systemPrompt,
        "the accepted systemPrompt must reach the cloud payload verbatim",
      ).toBe("You are a helpful assistant.");
      await agent.dispose();
    });

    it("accepts undefined systemPrompt", async () => {
      const agent = await Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS },
      });

      // Absent must serialize as absent — not as an empty string and not as an invented default.
      // The key itself is asserted, so a `systemPrompt: ""` would fail too.
      expect(payloadOf(agent)).not.toHaveProperty("systemPrompt");
      await agent.dispose();
    });
  });

  describe("rejections — function-based skills resolver (SE22)", () => {
    it("rejects skills declared as a resolver function", async () => {
      await expect(
        Agent.create({
          apiKey: FIXTURE_KEY,
          model: MODEL,
          cloud: { repos: REPOS },
          skills: () => ({ enabled: ["code-review"] }),
        }),
      ).rejects.toMatchObject({ code: "cloud_incompatible_function_resolver" });
    });

    it("accepts skills declared as a static settings object", async () => {
      const agent = await Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS },
        skills: { enabled: ["code-review"] },
      });

      expect(
        payloadOf(agent).skills,
        "the accepted static skills object must reach the cloud payload",
      ).toEqual({ enabled: ["code-review"] });
      await agent.dispose();
    });
  });

  describe("rejections — guardrail processors (SE24)", () => {
    it("rejects a cloud agent that declares inputProcessors", async () => {
      await expect(
        Agent.create({
          apiKey: FIXTURE_KEY,
          model: MODEL,
          cloud: { repos: REPOS },
          inputProcessors: [{ id: "guard", processInput: (ctx) => ctx.message }],
        }),
      ).rejects.toMatchObject({ code: "cloud_incompatible_function_resolver" });
    });

    it("rejects a cloud agent that declares outputProcessors", async () => {
      await expect(
        Agent.create({
          apiKey: FIXTURE_KEY,
          model: MODEL,
          cloud: { repos: REPOS },
          outputProcessors: [{ id: "redact", processOutput: (ctx) => ctx.text }],
        }),
      ).rejects.toMatchObject({ code: "cloud_incompatible_function_resolver" });
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

      // Accepting the bare command is only half the contract — PaaS cannot install the server
      // unless the command AND its args survive serialization.
      expect(payloadOf(agent).mcpServers?.search).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "@some/mcp-server"],
      });
      await agent.dispose();
    });

    it("accepts bare command uvx (Python ecosystem)", async () => {
      const agent = await Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS },
        mcpServers: { search: { type: "stdio", command: "uvx", args: ["mcp-server-x"] } },
      });

      expect(payloadOf(agent).mcpServers?.search).toEqual({
        type: "stdio",
        command: "uvx",
        args: ["mcp-server-x"],
      });
      await agent.dispose();
    });

    it("accepts bare command node", async () => {
      const agent = await Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        cloud: { repos: REPOS },
        mcpServers: { search: { type: "stdio", command: "node", args: ["server.js"] } },
      });

      expect(payloadOf(agent).mcpServers?.search).toEqual({
        type: "stdio",
        command: "node",
        args: ["server.js"],
      });
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

      const payload = payloadOf(agent);
      expect(payload.systemPrompt).toBe("ship the change");
      expect(payload.cloud).toMatchObject({ autoCreatePR: true });
      // Both transports have to survive together: an http entry and a stdio entry in one map.
      expect(payload.mcpServers).toEqual({
        http: { type: "http", url: "https://mcp.example.com" },
        stdio: { type: "stdio", command: "npx", args: ["-y", "@x/mcp"] },
      });
      await agent.dispose();
    });
  });
});
