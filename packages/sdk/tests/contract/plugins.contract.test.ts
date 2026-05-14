import { afterEach, describe, expect, it } from "vitest";

import { Agent, type AgentOptions, type SDKAgent } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("plugins contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("discovers file-based plugins only when settingSources includes plugins", async () => {
    workspace = await createTempWorkspace("project-with-plugins");
    const options: ProposedAgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd, settingSources: ["plugins"] },
      plugins: {
        enabled: ["search-provider"],
      },
    };
    const agent = (await Agent.create(options)) as ProposedSDKAgent;

    const plugins = await agent.plugins.list();

    expect(plugins).toEqual([
      expect.objectContaining({
        name: "search-provider",
        version: "0.0.1",
        capabilities: expect.arrayContaining(["web_search", "context_provider"]),
        source: expect.stringMatching(/\.theokit\/plugins\/search-provider/),
      }),
    ]);
  });

  it("plugin hook failures surface as public configuration errors instead of being silently ignored", async () => {
    workspace = await createTempWorkspace("project-with-plugins");
    await workspace.writeText(
      ".theokit/plugins/broken/plugin.json",
      JSON.stringify({ name: "broken", version: "0.0.1", entry: "./missing.js" }),
    );

    await expect(
      Agent.create({
        apiKey: "theo_test_contract_key",
        model: { id: "composer-2" },
        local: { cwd: workspace.cwd, settingSources: ["plugins"] },
        plugins: { enabled: ["broken"] },
      } as ProposedAgentOptions),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/plugin|missing/i),
    });
  });

  it("cloud rejects local plugin paths and requires committed plugin manifests", async () => {
    await expect(
      Agent.create({
        apiKey: "theo_test_contract_key",
        model: { id: "composer-2" },
        cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
        plugins: {
          paths: ["/tmp/local-plugin"],
          enabled: ["search-provider"],
        },
      } as ProposedAgentOptions),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/plugin|cloud|committed|path/i),
    });
  });
});

type ProposedAgentOptions = AgentOptions & {
  plugins?: {
    enabled?: string[];
    paths?: string[];
  };
};

type ProposedSDKAgent = SDKAgent & {
  plugins: {
    list(): Promise<Array<{ name: string; version: string; capabilities: string[]; source: string }>>;
  };
};
