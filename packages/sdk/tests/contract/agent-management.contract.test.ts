import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import cloudAgentInfoGolden from "../golden/agent/cloud-agent-info.json";
import localAgentInfoGolden from "../golden/agent/local-agent-info.json";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("Agent management contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("lists and gets local agents with stable SDKAgentInfo shape and pagination", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      name: "Contract Local Agent",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });

    const listed = await Agent.list({ runtime: "local", cwd: workspace.cwd, limit: 10 });
    const fetched = await Agent.get(agent.agentId, { cwd: workspace.cwd });

    expect(listed).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ agentId: agent.agentId })]),
    });
    expect(listed.items.length).toBeGreaterThanOrEqual(1);
    expect(normalizeForGolden(fetched)).toEqual(localAgentInfoGolden);
  });

  it("lists, filters, archives, unarchives, and deletes cloud agents", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      name: "Contract Cloud Agent",
      model: { id: "composer-2" },
      cloud: {
        repos: [{ url: "https://github.com/usetheo/example" }],
        autoCreatePR: true,
      },
    });

    const listed = await Agent.list({
      runtime: "cloud",
      prUrl: "https://github.com/usetheo/example/pull/123",
      includeArchived: true,
      apiKey: "theo_test_contract_key",
      limit: 10,
    });
    const fetched = await Agent.get(agent.agentId, { apiKey: "theo_test_contract_key" });

    expect(listed.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ agentId: agent.agentId })]),
    );
    expect(normalizeForGolden(fetched)).toEqual(cloudAgentInfoGolden);

    await expect(
      Agent.archive(agent.agentId, { apiKey: "theo_test_contract_key" }),
    ).resolves.toBeUndefined();
    await expect(
      Agent.get(agent.agentId, { apiKey: "theo_test_contract_key" }),
    ).resolves.toMatchObject({
      archived: true,
    });
    await expect(
      Agent.unarchive(agent.agentId, { apiKey: "theo_test_contract_key" }),
    ).resolves.toBeUndefined();
    await expect(
      Agent.get(agent.agentId, { apiKey: "theo_test_contract_key" }),
    ).resolves.toMatchObject({
      archived: false,
    });
    await expect(
      Agent.delete(agent.agentId, { apiKey: "theo_test_contract_key" }),
    ).resolves.toBeUndefined();
    await expect(
      Agent.get(agent.agentId, { apiKey: "theo_test_contract_key" }),
    ).rejects.toMatchObject({
      name: "UnknownAgentError",
      code: expect.any(String),
    });
  });

  it("lists and gets runs for an agent without losing Run operations", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Summarize fixture for listRuns.");
    await run.wait();

    const listedRuns = await Agent.listRuns(agent.agentId, {
      runtime: "local",
      cwd: workspace.cwd,
      limit: 10,
    });
    const fetchedRun = await Agent.getRun(run.id, { runtime: "local", cwd: workspace.cwd });

    expect(listedRuns.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: run.id,
          agentId: agent.agentId,
          wait: expect.any(Function),
          stream: expect.any(Function),
          conversation: expect.any(Function),
        }),
      ]),
    );
    expect(fetchedRun).toMatchObject({
      id: run.id,
      agentId: agent.agentId,
      status: "finished",
      wait: expect.any(Function),
    });
  });

  it("requires parent agentId for cloud getRun and routes by bc prefix", async () => {
    await expect(
      Agent.getRun("run-00000000-0000-4000-8000-000000000001", { runtime: "cloud" } as never),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/agentId/i),
    });

    const run = await Agent.getRun("run-00000000-0000-4000-8000-000000000001", {
      runtime: "cloud",
      agentId: "bc-00000000-0000-4000-8000-000000000001",
      apiKey: "theo_test_contract_key",
    });

    expect(run).toMatchObject({
      id: expect.stringMatching(/^run-/),
      agentId: expect.stringMatching(/^bc-/),
      supports: expect.any(Function),
    });
  });
});
