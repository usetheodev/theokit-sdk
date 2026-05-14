import { afterEach, describe, expect, it } from "vitest";

import { Agent, type AgentOptions, type SDKAgent, Theokit } from "../../src/index.js";
import routesGolden from "../golden/providers/routes.json";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("provider routing contract", () => {
  let workspace: TempWorkspace | undefined;
  const previousToken = process.env.FIXTURE_SEARCH_TOKEN;

  afterEach(async () => {
    if (previousToken === undefined) {
      delete process.env.FIXTURE_SEARCH_TOKEN;
    } else {
      process.env.FIXTURE_SEARCH_TOKEN = previousToken;
    }
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("routes chat and tool capabilities through explicit provider rules", async () => {
    process.env.FIXTURE_SEARCH_TOKEN = "fixture-search-secret";
    workspace = await createTempWorkspace("project-with-plugins");
    const options: ProposedAgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "anthropic:claude-3-7-sonnet" },
      local: { cwd: workspace.cwd, settingSources: ["plugins"] },
      plugins: { enabled: ["search-provider"] },
      providers: {
        routes: [
          { capability: "chat", provider: "anthropic" },
          { capability: "web_search", provider: "fixture-search" },
        ],
        fallback: ["openrouter", "nous"],
      },
    };
    const agent = (await Agent.create(options)) as ProposedSDKAgent;

    const routes = await agent.providers.routes();
    const run = await agent.send("Search docs for SDK contract testing patterns.");
    const events = [];
    for await (const event of run.stream()) events.push(event);

    expect(normalizeForGolden(routes)).toEqual(routesGolden);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call",
          name: expect.stringMatching(/web_search/),
        }),
      ]),
    );
    expect(JSON.stringify({ routes, events })).not.toContain("fixture-search-secret");
  });

  it("falls back when explicit provider is unavailable and reports routing metadata", async () => {
    workspace = await createTempWorkspace("project-with-plugins");
    const options: ProposedAgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "unavailable:missing-model" },
      local: { cwd: workspace.cwd, settingSources: ["plugins"] },
      providers: {
        routes: [{ capability: "chat", provider: "unavailable" }],
        fallback: ["openrouter", "nous"],
      },
    };
    const agent = await Agent.create(options);

    const run = await agent.send("Use provider fallback.");
    const result = await run.wait();

    expect(result.model).toMatchObject({
      id: expect.stringMatching(/^(openrouter|nous):/),
    });
    expect(result as typeof result & { provider?: unknown }).toMatchObject({
      provider: expect.objectContaining({
        requested: "unavailable",
        selected: expect.stringMatching(/openrouter|nous/),
        fallbackReason: expect.stringMatching(/unavailable|missing/i),
      }),
    });
  });

  it("Theokit providers catalog exposes availability and setup schema without secrets", async () => {
    const providersApi = (Theokit as ProposedTheokit).providers;
    expect(providersApi?.list).toEqual(expect.any(Function));

    const providers = await providersApi.list({
      apiKey: "theo_test_contract_key",
    });

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.any(String),
          displayName: expect.any(String),
          capabilities: expect.arrayContaining([expect.any(String)]),
          isAvailable: expect.any(Boolean),
          setupSchema: expect.any(Object),
        }),
      ]),
    );
    expect(JSON.stringify(providers)).not.toMatch(/token|secret|api[_-]?key/i);
  });
});

type ProposedAgentOptions = AgentOptions & {
  plugins?: {
    enabled?: string[];
  };
  providers?: {
    routes: Array<{ capability: "chat" | "web_search" | "image" | "embedding"; provider: string }>;
    fallback?: string[];
  };
};

type ProposedSDKAgent = SDKAgent & {
  providers: {
    routes(): Promise<Array<{ capability: string; provider: string; model?: string; reason: string }>>;
  };
};

type ProposedTheokit = typeof Theokit & {
  providers: {
    list(options?: { apiKey?: string }): Promise<
      Array<{
        name: string;
        displayName: string;
        capabilities: string[];
        isAvailable: boolean;
        setupSchema: object;
      }>
    >;
  };
};
