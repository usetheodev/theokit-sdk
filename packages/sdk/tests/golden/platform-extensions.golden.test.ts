import { afterEach, describe, expect, it } from "vitest";

import { Agent, Theokit } from "../../src/index.js";
import { assertGoldenHasContractSignal, normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";
import contextSnapshotGolden from "./context/snapshot.local.json";
import providerRoutesGolden from "./providers/routes.json";

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
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd },
      context: {
        manager: "file",
        maxTokens: 1200,
      },
    });

    if (!agent.context)
      throw new Error("agent.context should be populated when context settings are provided");
    const snapshot = await agent.context.snapshot();
    const normalized = normalizeForGolden(snapshot);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(contextSnapshotGolden);
    expect(JSON.stringify(normalized)).not.toContain("SHOULD_NOT_LEAK");
  });

  it("matches normalized provider routes golden", async () => {
    process.env.FIXTURE_SEARCH_TOKEN = "fixture-search-secret";
    workspace = await createTempWorkspace("project-with-plugins");
    const agent = await Agent.create({
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
    });

    if (!agent.providers)
      throw new Error("agent.providers should be populated when provider routes are configured");
    const routes = await agent.providers.routes();
    const normalized = normalizeForGolden(routes);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(providerRoutesGolden);
    expect(JSON.stringify(normalized)).not.toContain("fixture-search-secret");
  });

  it("provider catalog output remains public and secret-free", async () => {
    expect(typeof Theokit.providers.list).toBe("function");

    const providers = await Theokit.providers.list({ apiKey: "theo_test_contract_key" });
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
    expect(JSON.stringify(normalized)).not.toMatch(
      /api[_-]?key|authorization|password|secret|token/i,
    );
  });
});
