import { afterEach, describe, expect, it } from "vitest";

import { Agent, type AgentOptions, type SDKAgent } from "../../src/index.js";
import contextGolden from "../golden/context/snapshot.local.json";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("engine context manager contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("loads file-based project context, honors token budget, and excludes secrets", async () => {
    workspace = await createTempWorkspace("project-with-context");
    const options: ProposedAgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd, settingSources: ["project"] },
      context: {
        manager: "file",
        maxTokens: 1200,
      },
    };
    const agent = (await Agent.create(options)) as ProposedSDKAgent;

    const snapshot = await agent.context.snapshot();
    const run = await agent.send(
      "Answer using loaded project context: what kind of tests are used?",
    );
    const result = await run.wait();

    expect(normalizeForGolden(snapshot)).toEqual(contextGolden);
    expect(JSON.stringify(snapshot)).not.toContain("theo_should_not_leak");
    expect(JSON.stringify(snapshot)).not.toContain("sk-proj-context-secret");
    expect(result.result).toMatch(/contract tests/i);
  });

  it("reload refreshes context manager state without disposing the agent", async () => {
    workspace = await createTempWorkspace("project-with-context");
    const options: ProposedAgentOptions = {
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd, settingSources: ["project"] },
      context: { manager: "file", maxTokens: 1200 },
    };
    const agent = (await Agent.create(options)) as ProposedSDKAgent;
    const before = await agent.context.snapshot();

    await workspace.writeText(
      "docs/architecture.md",
      "# Architecture\n\nReloaded context marker: zinc.",
    );
    await agent.reload();
    const after = await agent.context.snapshot();

    expect(JSON.stringify(before)).not.toEqual(JSON.stringify(after));
    expect(JSON.stringify(after)).toContain("zinc");
  });
});

type ProposedAgentOptions = AgentOptions & {
  context?: {
    manager: "file" | "inline";
    maxTokens?: number;
  };
};

type ProposedSDKAgent = SDKAgent & {
  context: {
    snapshot(): Promise<unknown>;
  };
};
