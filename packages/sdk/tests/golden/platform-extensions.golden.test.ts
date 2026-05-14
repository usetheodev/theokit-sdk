import { afterEach, describe, expect, it } from "vitest";

import { Agent, Theokit, type AgentOptions, type SDKAgent } from "../../src/index.js";
import contextSnapshotGolden from "./context/snapshot.local.json";
import providerRoutesGolden from "./providers/routes.json";
import { assertGoldenHasContractSignal, normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("platform extension golden contracts", () => {
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

  it("matches normalized local engine context snapshot golden", async () => {
    workspace = await createTempWorkspace("project-with-context");
    const options: ProposedAgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
      context: {
        sources: ["project"],
        maxTokens: 1200,
      },
    };
    const agent = (await Agent.create(options)) as ProposedSDKAgent;

    const snapshot = await agent.context.snapshot();
    const normalized = normalizeForGolden(snapshot);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(contextSnapshotGolden);
    expect(JSON.stringify(normalized)).not.toContain("SHOULD_NOT_LEAK");
  });

  it("matches normalized provider routes golden", async () => {
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
    const normalized = normalizeForGolden(routes);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(providerRoutesGolden);
    expect(JSON.stringify(normalized)).not.toContain("fixture-search-secret");
  });

  it("provider catalog output remains public and secret-free", async () => {
    const providersApi = (Theokit as ProposedTheokit).providers;
    expect(providersApi?.list).toEqual(expect.any(Function));

    const providers = await providersApi.list({ apiKey: "theo_test_contract_key" });
    const normalized = normalizeForGolden(providers);

    expect(normalized).toEqual(
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
    expect(JSON.stringify(normalized)).not.toMatch(/api[_-]?key|authorization|password|secret|token/i);
  });
});

type ProposedAgentOptions = AgentOptions & {
  context?: {
    sources: string[];
    maxTokens: number;
  };
  plugins?: {
    enabled?: string[];
  };
  providers?: {
    routes: Array<{ capability: "chat" | "web_search" | "image" | "embedding"; provider: string }>;
    fallback?: string[];
  };
};

type ProposedSDKAgent = SDKAgent & {
  context: {
    snapshot(): Promise<unknown>;
  };
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
